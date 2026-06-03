import { NextResponse } from "next/server";
import { setEpisodeStatus } from "@/lib/episodes";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  setEpisodeStatus(slug, "rejected");
  return NextResponse.json({ ok: true, slug, status: "rejected" });
}
