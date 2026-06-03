import { NextResponse } from "next/server";
import { episodeDir } from "@/lib/episodes";
import fs from "fs";
import path from "path";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const dir = episodeDir(slug);
  const abs = path.resolve(dir, filePath);

  // Must stay within episode directory
  if (abs !== dir && !abs.startsWith(dir + path.sep)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = path.extname(abs).slice(1).toLowerCase();

  if (ext === "mp3") {
    const data = fs.readFileSync(abs);
    return new NextResponse(data, {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }

  const content = fs.readFileSync(abs, "utf-8");
  return new NextResponse(content, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
