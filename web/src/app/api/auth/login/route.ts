import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";

export async function POST(request: Request) {
  const { password } = await request.json();
  const expected = process.env.AUTH_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: "AUTH_PASSWORD not configured" }, { status: 500 });
  }

  if (!password || password !== expected) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await createSession();
  return NextResponse.json({ ok: true });
}
