"use server";

import { setEpisodeStatus } from "@/lib/episodes";
import { triggerWebhook } from "@/lib/n8n";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function startPhase1(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error: string }> {
  const topic = (formData.get("topic") as string)?.trim();
  if (!topic) return { error: "Topic is required" };

  const webhookPath = process.env.N8N_PHASE1_WEBHOOK;
  if (!webhookPath) return { error: "N8N_PHASE1_WEBHOOK not configured" };

  try {
    await triggerWebhook(webhookPath, { topic });
  } catch (e) {
    return { error: `Failed to reach n8n: ${String(e)}` };
  }

  redirect("/episodes");
}

export async function startPhase2(slug: string): Promise<{ error?: string }> {
  const webhookPath = process.env.N8N_PHASE2_WEBHOOK;
  if (!webhookPath) return { error: "N8N_PHASE2_WEBHOOK not configured" };

  setEpisodeStatus(slug, "running");
  try {
    await triggerWebhook(webhookPath, { slug });
  } catch (e) {
    setEpisodeStatus(slug, "error");
    return { error: `Failed to reach n8n: ${String(e)}` };
  }

  revalidatePath(`/episodes/${slug}`);
  return {};
}

export async function startPhase3(slug: string): Promise<{ error?: string }> {
  const webhookPath = process.env.N8N_PHASE3_WEBHOOK;
  if (!webhookPath) return { error: "N8N_PHASE3_WEBHOOK not configured" };

  setEpisodeStatus(slug, "running");
  try {
    await triggerWebhook(webhookPath, { slug });
  } catch (e) {
    setEpisodeStatus(slug, "error");
    return { error: `Failed to reach n8n: ${String(e)}` };
  }

  revalidatePath(`/episodes/${slug}`);
  return {};
}

export async function startPhase1ForEpisode(slug: string): Promise<{ error?: string }> {
  const projectDir = `/Users/jneal/n8n_projects/${slug}`;
  const webhookPath = process.env.N8N_PHASE1_WEBHOOK ?? "ruins-untold/phase1";

  const fs = await import("fs");
  const path = await import("path");

  // Read full topic from .topic file — the slug is truncated at 45 chars and can't
  // be used to reconstruct the original topic for Google Sheets matching.
  let topic: string;
  try {
    topic = fs.readFileSync(path.join(projectDir, ".topic"), "utf-8").trim();
    if (!topic) throw new Error("empty");
  } catch {
    topic = slug.replace(/_\d{12}$/, "").replace(/_/g, " ");
  }

  // Read sheet row number so n8n can match by index rather than topic text.
  let rowNumber: number | undefined;
  try {
    const raw = fs.readFileSync(path.join(projectDir, ".row_number"), "utf-8").trim();
    const n = parseInt(raw, 10);
    if (!isNaN(n)) rowNumber = n;
  } catch { /* no .row_number file — episode wasn't promoted from Ideas */ }

  setEpisodeStatus(slug, "running");
  try {
    await triggerWebhook(webhookPath, { topic, slug, projectDir, rowNumber });
  } catch (e) {
    setEpisodeStatus(slug, "error");
    return { error: `Failed to reach n8n: ${String(e)}` };
  }

  revalidatePath(`/episodes/${slug}`);
  return {};
}

/**
 * Resume an episode that was paused by the Phase 1/2/3 "Write Error Status" node
 * after a Claude Bridge `usage_limit` error. Reads `.paused_until` to determine
 * which phase was running, clears the file, and re-triggers that phase's existing
 * Start action — the same webhook a manual "Start Phase N" click would use.
 */
export async function resumeFromPause(slug: string): Promise<{ error?: string }> {
  const fs = await import("fs");
  const path = await import("path");
  const dir = `/Users/jneal/n8n_projects/${slug}`;

  let phase: number;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, ".paused_until"), "utf-8"));
    phase = typeof raw.phase === "number" ? raw.phase : 0;
  } catch {
    return { error: "No .paused_until file found — was this episode actually paused?" };
  }

  try { fs.unlinkSync(path.join(dir, ".paused_until")); } catch { /* non-fatal */ }

  switch (phase) {
    case 1:
      return startPhase1ForEpisode(slug);
    case 2:
      return startPhase2(slug);
    case 3:
      return startPhase3(slug);
    default:
      setEpisodeStatus(slug, "error");
      return { error: `Unknown paused phase: ${phase}` };
  }
}

export async function rejectEpisode(slug: string): Promise<{ error?: string }> {
  setEpisodeStatus(slug, "rejected");
  revalidatePath(`/episodes/${slug}`);
  return {};
}

export async function approveMediaPrompts(
  slug: string,
  edits: { imageManifest?: string; videoManifest?: string }
): Promise<{ error?: string }> {
  const fs = await import("fs");
  const path = await import("path");
  const dir = `/Users/jneal/n8n_projects/${slug}`;

  if (edits.imageManifest) {
    try {
      JSON.parse(edits.imageManifest);
      fs.writeFileSync(path.join(dir, "scripts", "image_manifest.json"), edits.imageManifest, "utf-8");
    } catch (e) {
      return { error: `Invalid image manifest JSON: ${String(e)}` };
    }
  }
  if (edits.videoManifest) {
    try {
      JSON.parse(edits.videoManifest);
      fs.writeFileSync(path.join(dir, "scripts", "video_manifest.json"), edits.videoManifest, "utf-8");
    } catch (e) {
      return { error: `Invalid video manifest JSON: ${String(e)}` };
    }
  }

  let resumeUrl: string;
  try {
    resumeUrl = fs.readFileSync(path.join(dir, ".n8n_resume_url"), "utf-8").trim();
    if (!resumeUrl) throw new Error("empty");
  } catch {
    return { error: "No n8n resume URL found — was the workflow paused correctly?" };
  }

  setEpisodeStatus(slug, "running");
  try {
    const res = await fetch(resumeUrl, { method: "GET" });
    if (!res.ok) {
      setEpisodeStatus(slug, "awaiting_media_approval");
      return { error: `n8n resume failed: HTTP ${res.status}` };
    }
  } catch (e) {
    setEpisodeStatus(slug, "awaiting_media_approval");
    return { error: `Failed to reach n8n: ${String(e)}` };
  }

  revalidatePath(`/episodes/${slug}`);
  return {};
}

/**
 * Mark an episode as done and sync the corresponding idea in Google Sheets to "Complete".
 * Reads the .row_number sentinel file written when the episode was promoted from the
 * Idea Catalog. If the file is absent (episode created manually), the sheet sync is
 * skipped and the episode is still marked done.
 */
export async function markEpisodeDone(slug: string): Promise<{ error?: string }> {
  const fs   = await import("fs");
  const path = await import("path");
  const dir  = `/Users/jneal/n8n_projects/${slug}`;

  // Best-effort: sync idea status to Complete
  try {
    const raw = fs.readFileSync(path.join(dir, ".row_number"), "utf-8").trim();
    const rowNumber = parseInt(raw, 10);
    if (!isNaN(rowNumber) && rowNumber >= 2) {
      const { updateIdea } = await import("@/lib/sheets");
      await updateIdea(rowNumber, { status: "Complete" });
    }
  } catch {
    // No .row_number file or sheet update failed — non-fatal, proceed to mark done.
  }

  setEpisodeStatus(slug, "done");
  revalidatePath(`/episodes/${slug}`);
  revalidatePath("/episodes");
  return {};
}

export async function setYoutubeUrl(slug: string, url: string): Promise<{ error?: string }> {
  const dir = `/Users/jneal/n8n_projects/${slug}`;
  const fs = await import("fs");
  const path = await import("path");
  try {
    fs.writeFileSync(path.join(dir, ".youtube_url"), url.trim(), "utf-8");
  } catch (e) {
    return { error: String(e) };
  }
  revalidatePath(`/episodes/${slug}`);
  revalidatePath("/episodes");
  return {};
}

const THUMBNAIL_TEMPLATE_NAMES: Record<number, string> = {
  1: "Revelation Shot",
  2: "Explorer Face",
  3: "Split Reveal",
  4: "Mystery Object",
  5: "Location Atmosphere",
};

const THUMBNAIL_AGENT_PROMPT_PATH =
  "/Users/jneal/n8n_projects/ruins_untold_system_prompts/thumbnail_agent.md";

/**
 * Generate a Nano Banana 2 thumbnail prompt via the Claude Bridge — the Web UI
 * equivalent of the `ru-thumbnail` skill / Phase 3's old "Build Thumbnail Prompt" ->
 * "Call Claude Thumbnail" -> "Save Thumbnail Prompt" node chain. Writes
 * `scripts/thumbnail_prompt_<N>.json` (N = next unused generation number) and returns
 * any error for display.
 */
export async function generateThumbnailPrompt(
  slug: string,
  template: number,
  titleOverride?: string
): Promise<{ error?: string }> {
  if (!Number.isInteger(template) || template < 1 || template > 5) {
    return { error: "Template must be between 1 and 5" };
  }

  const fs = await import("fs");
  const path = await import("path");
  const { callClaudeBridge } = await import("@/lib/claude-bridge");
  const dir = `/Users/jneal/n8n_projects/${slug}`;
  const scriptsDir = path.join(dir, "scripts");

  let topic: string;
  try {
    topic = fs.readFileSync(path.join(dir, ".topic"), "utf-8").trim();
    if (!topic) throw new Error("empty");
  } catch {
    topic = slug.replace(/_\d{12}$/, "").replace(/_/g, " ");
  }
  const episodeTitle = (titleOverride ?? "").trim() || topic;

  let systemPrompt: string;
  try {
    systemPrompt = fs.readFileSync(THUMBNAIL_AGENT_PROMPT_PATH, "utf-8");
  } catch (e) {
    return { error: `Could not read thumbnail agent prompt: ${String(e)}` };
  }

  const fullPrompt =
    systemPrompt +
    "\n\n---\n\nTemplate: " +
    template +
    " — " +
    (THUMBNAIL_TEMPLATE_NAMES[template] ?? "Unknown") +
    "\nEpisode title: " +
    episodeTitle;

  let resp;
  try {
    resp = await callClaudeBridge(fullPrompt);
  } catch (e) {
    return { error: `Failed to reach Claude bridge: ${String(e)}` };
  }

  if (resp.exitCode !== 0) {
    if (resp.error === "usage_limit") {
      const ra = resp.retryAfter
        ? new Date(resp.retryAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "later";
      return { error: `Claude usage limit reached. Try again around ${ra}.` };
    }
    return { error: `Thumbnail agent error: ${resp.error || "unknown error"}` };
  }

  const raw = resp.output || "";
  const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/);
  let thumbnailJson: unknown = null;
  if (jsonMatch) {
    try {
      thumbnailJson = JSON.parse(jsonMatch[1]);
    } catch {
      // leave null — caught below
    }
  }
  if (!thumbnailJson) {
    return { error: "Could not parse a JSON thumbnail prompt from Claude's response" };
  }

  const textMatch = raw.match(/>\s*Text overlay suggestion:\s*(.+)/);
  const genMatch = raw.match(/>\s*To generate:\s*(.+)/);

  fs.mkdirSync(scriptsDir, { recursive: true });
  const existingGenerations = fs
    .readdirSync(scriptsDir)
    .map((f) => f.match(/^thumbnail_prompt_(\d+)\.json$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1], 10));
  const generation = existingGenerations.length ? Math.max(...existingGenerations) + 1 : 1;

  const pkg = {
    episode_title: episodeTitle,
    template,
    generation,
    generated_at: new Date().toISOString(),
    thumbnail_json: thumbnailJson,
    text_overlay: textMatch ? textMatch[1].trim() : "",
    kie_command: genMatch ? genMatch[1].trim() : "",
    raw_output: raw,
  };

  try {
    fs.writeFileSync(
      path.join(scriptsDir, `thumbnail_prompt_${generation}.json`),
      JSON.stringify(pkg, null, 2),
      "utf-8"
    );
  } catch (e) {
    return { error: `Failed to write thumbnail_prompt_${generation}.json: ${String(e)}` };
  }

  revalidatePath(`/episodes/${slug}`);
  return {};
}
