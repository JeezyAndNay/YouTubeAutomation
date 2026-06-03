import { NextResponse } from "next/server";
import { triggerWebhook } from "@/lib/n8n";

export async function POST() {
  // Webhook path TBD — "Ruins Untold - Idea Catalog" n8n workflow
  const webhookPath = process.env.N8N_IDEAS_WEBHOOK ?? "ruins-untold/generate-ideas";
  const result = await triggerWebhook(webhookPath, {});
  return NextResponse.json(result);
}
