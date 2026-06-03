import { NextResponse } from "next/server";
import { episodeDir } from "@/lib/episodes";
import fs from "fs";
import path from "path";

type FileEntry = { name: string; type: "file" | "dir"; size?: number; ext?: string };

function walk(dir: string, base: string): FileEntry[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).map((d): FileEntry => {
    const rel = path.relative(base, path.join(dir, d.name));
    if (d.isDirectory()) return { name: rel, type: "dir" };
    const stat = fs.statSync(path.join(dir, d.name));
    return { name: rel, type: "file", size: stat.size, ext: path.extname(d.name).slice(1) };
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = episodeDir(slug);
  if (!fs.existsSync(dir)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const files = walk(dir, dir);
  return NextResponse.json({ slug, dir, files });
}
