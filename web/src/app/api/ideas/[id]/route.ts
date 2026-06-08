import { NextResponse } from "next/server";
import { updateIdea, deleteIdea, type IdeaStatus } from "@/lib/sheets";

const VALID_STATUSES: IdeaStatus[] = ["New", "In Progress", "Complete"];

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

  if (patch.status !== undefined && !VALID_STATUSES.includes(patch.status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await updateIdea(rowNumber, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}

// [id] is the sheet row number (2-based) — permanently removes the row
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rowNumber = parseInt(id, 10);
  if (isNaN(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ error: "invalid row number" }, { status: 400 });
  }

  try {
    await deleteIdea(rowNumber);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
