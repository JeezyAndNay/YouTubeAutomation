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
  const topic = slug.replace(/_\d{12}$/, "").replace(/_/g, " ");
  const projectDir = `/Users/jneal/n8n_projects/${slug}`;
  const webhookPath = process.env.N8N_PHASE1_WEBHOOK ?? "ruins-untold/phase1";

  setEpisodeStatus(slug, "running");
  try {
    await triggerWebhook(webhookPath, { topic, slug, projectDir });
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
