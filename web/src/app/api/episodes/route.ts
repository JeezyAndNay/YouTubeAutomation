import { NextResponse } from "next/server";
import { listEpisodes } from "@/lib/episodes";
import fs from "fs";
import path from "path";

const PROJECTS_DIR = "/Users/jneal/n8n_projects";
const EPISODE_SUBDIRS = ["scripts", "audio", "images", "videos", "clips", "music", "sfx"];

export async function GET() {
  const episodes = listEpisodes();
  return NextResponse.json(episodes);
}

export async function POST(request: Request) {
  const { topic } = await request.json();
  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const clean = topic.trim();
  const ts = new Date().toISOString().replace(/[^0-9]/g, "").substring(0, 12);
  const slug =
    clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 45) +
    "_" +
    ts;
  const projectDir = path.join(PROJECTS_DIR, slug);

  try {
    fs.mkdirSync(projectDir, { recursive: true });
    for (const dir of EPISODE_SUBDIRS) {
      fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(projectDir, ".topic"), clean, "utf-8");
    return NextResponse.json({ slug }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
