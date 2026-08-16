import { NextResponse } from "next/server";
import { listEpisodes, episodeDir, setEpisodeStatus } from "@/lib/episodes";
import type { EpisodeStatus } from "@/lib/episodes";
import { getExecutions } from "@/lib/n8n";
import fs from "fs";
import path from "path";

const VALID_STATUSES: EpisodeStatus[] = [
  "idle", "running", "awaiting_review", "awaiting_script_approval", "awaiting_media_approval", "ready_for_phase3", "done", "error", "rejected", "paused_until",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = episodeDir(slug);
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { status?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const { status } = body;
  if (!status || !VALID_STATUSES.includes(status as EpisodeStatus)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  setEpisodeStatus(slug, status as EpisodeStatus);
  return NextResponse.json({ ok: true, status });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const episodes = listEpisodes();
  const episode = episodes.find((e) => e.slug === slug);
  if (!episode) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Try to get latest n8n execution status for this episode
  let execution = null;
  try {
    const executions = await getExecutions();
    execution = executions.data.find((e) =>
      e.data && JSON.stringify(e.data).includes(slug)
    ) ?? null;
  } catch {
    // n8n may not be running; non-fatal
  }

  // Read latest phase outputs that exist
  const dir = episodeDir(slug);
  const outputs: Record<string, boolean> = {
    research:   fs.existsSync(path.join(dir, "scripts", "research_package.json")),
    script:     fs.existsSync(path.join(dir, "scripts", "script.md")),
    timeline:   fs.existsSync(path.join(dir, "scripts", "media_timeline.json")),
    images:     fs.existsSync(path.join(dir, "scripts", "image_manifest.json")),
    videos:     fs.existsSync(path.join(dir, "scripts", "video_manifest.json")),
    metadata:   fs.existsSync(path.join(dir, "scripts", "metadata_package.json")),
    voiceover:  fs.existsSync(path.join(dir, "audio", "voiceover_final.mp3")),
  };

  return NextResponse.json({ episode, execution, outputs });
}
