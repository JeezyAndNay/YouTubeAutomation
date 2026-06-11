// Thin client for the Claude Bridge (`infra/claude-bridge/claude-bridge.py`), which proxies
// to the Claude Code CLI. The Web UI runs via `next dev` on the host (not Docker), so it talks
// to the bridge over `localhost`, unlike n8n which uses `host.docker.internal`.

const CLAUDE_BRIDGE_URL = process.env.CLAUDE_BRIDGE_URL ?? "http://localhost:3333";

export type BridgeResponse = {
  output: string;
  exitCode: number;
  error: string;
  retryAfter?: string;
  rawError?: string;
};

/**
 * POST a prompt to the Claude Bridge `/generate` endpoint and return its parsed response.
 * Throws on network/HTTP errors — callers should catch and surface a friendly message.
 */
export async function callClaudeBridge(
  prompt: string,
  opts?: { system?: string; model?: string; maxTokens?: number; effort?: string; timeoutMs?: number }
): Promise<BridgeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 300_000);

  try {
    const res = await fetch(`${CLAUDE_BRIDGE_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ...(opts?.system ? { system: opts.system } : {}),
        ...(opts?.model ? { model: opts.model } : {}),
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts?.effort ? { effort: opts.effort } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Claude bridge returned HTTP ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as BridgeResponse;
  } finally {
    clearTimeout(timeout);
  }
}
