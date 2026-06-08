import { NextRequest, NextResponse } from "next/server";
import { triggerWebhook } from "@/lib/n8n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const quantity = body.quantity ? parseInt(String(body.quantity), 10) : undefined;
  const keyword  = body.keyword  ? String(body.keyword).trim()         : undefined;

  const webhookPath = process.env.N8N_IDEAS_WEBHOOK ?? "ruins-untold/generate-ideas";
  const result = await triggerWebhook(webhookPath, {
    ...(quantity ? { quantity } : {}),
    ...(keyword  ? { keyword  } : {}),
  });
  return NextResponse.json(result);
}
