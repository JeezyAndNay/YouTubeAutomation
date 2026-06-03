import { NextResponse } from "next/server";
import { setEpisodeStatus } from "@/lib/episodes";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  setEpisodeStatus(slug, "awaiting_review");
  return NextResponse.json({ ok: true, slug, status: "awaiting_review" });
}
