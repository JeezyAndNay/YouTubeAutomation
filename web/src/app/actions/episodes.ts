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
