import { NextResponse } from "next/server";
import { getIdeas } from "@/lib/sheets";

export async function GET() {
  try {
    const ideas = await getIdeas();
    return NextResponse.json(ideas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
