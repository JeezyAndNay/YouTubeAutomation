const N8N_BASE = process.env.N8N_BASE_URL ?? "http://localhost:5678";
const N8N_KEY  = process.env.N8N_API_KEY  ?? "";

// ── Workflow IDs (confirmed via API 2026-06-03) ───────────────────────────────
export const WORKFLOWS = {
  ideaCatalog: process.env.N8N_WORKFLOW_IDEA_CATALOG ?? "U1tRfasrm5coiHo8",
  phase1:      process.env.N8N_WORKFLOW_PHASE1       ?? "YNCvi72wqNsGyXtH",
  phase2:      process.env.N8N_WORKFLOW_PHASE2       ?? "nw7PXooaFleaw4AU",
  phase3:      process.env.N8N_WORKFLOW_PHASE3       ?? "rU-phase3-v2-2026",
} as const;

// ── REST API client ────────────────────────────────────────────────────────────

async function n8nFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${N8N_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_KEY,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`n8n ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type N8nExecution = {
  id: string;
  workflowId: string;
  status: "new" | "running" | "success" | "error" | "waiting" | "canceled";
  startedAt: string;
  stoppedAt?: string;
  data?: unknown;
};

// ── Executions ────────────────────────────────────────────────────────────────

export async function getExecutions(opts?: {
  workflowId?: string;
  limit?: number;
  status?: N8nExecution["status"];
}): Promise<{ data: N8nExecution[] }> {
  const params = new URLSearchParams();
  if (opts?.workflowId) params.set("workflowId", opts.workflowId);
  if (opts?.limit)      params.set("limit",      String(opts.limit));
  if (opts?.status)     params.set("status",      opts.status);
  const qs = params.size ? `?${params}` : "";
  return n8nFetch(`/executions${qs}`);
}

export async function getExecution(id: string): Promise<N8nExecution> {
  return n8nFetch(`/executions/${id}`);
}

export async function getLatestExecution(workflowId: string): Promise<N8nExecution | null> {
  const result = await getExecutions({ workflowId, limit: 1 });
  return result.data[0] ?? null;
}

// ── Webhook trigger ───────────────────────────────────────────────────────────
// Requires a Webhook node to be added to the target workflow.
// Webhook path is stored in .env.local (N8N_PHASE1_WEBHOOK etc.)

export async function triggerWebhook(webhookPath: string, body: unknown) {
  if (!webhookPath) throw new Error("Webhook path not configured for this workflow");
  const res = await fetch(`${N8N_BASE}/webhook/${webhookPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Workflow info ─────────────────────────────────────────────────────────────

export async function getWorkflow(id: string) {
  return n8nFetch(`/workflows/${id}`);
}
