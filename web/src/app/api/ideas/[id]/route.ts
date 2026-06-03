import { NextResponse } from "next/server";
import { updateIdea } from "@/lib/sheets";

// [id] is the sheet row number (2-based)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rowNumber = parseInt(id, 10);
  if (isNaN(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ error: "invalid row number" }, { status: 400 });
  }

  const patch = await request.json();

  try {
    await updateIdea(rowNumber, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
