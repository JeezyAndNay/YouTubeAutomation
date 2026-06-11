# Claude Bridge

HTTP bridge exposing Claude to Docker-based n8n. Runs on the host (not in Docker)
so it can shell out to the `claude` CLI and reach the local Claude Code subscription
session. n8n reaches it via `http://host.docker.internal:3333/generate`.

This is the source of truth for `claude-bridge.py`. The **deployed** copy that the
running bridge process actually executes lives at:

```
/Users/jneal/n8n_projects/ClaudeBridge/claude-bridge.py
```

## After editing this file

Copy the change to the deployed location, then restart the bridge:

```bash
cp infra/claude-bridge/claude-bridge.py /Users/jneal/n8n_projects/ClaudeBridge/claude-bridge.py

# Restart (CLI mode — no ANTHROPIC_API_KEY)
pgrep -fl claude-bridge      # find the running PID
kill <pid>
cd /Users/jneal/n8n_projects/ClaudeBridge
nohup python3 -u claude-bridge.py > bridge.log 2>&1 &
```

Before restarting, confirm no episode is mid-run (`.status = "running"` in any
`/Users/jneal/n8n_projects/{slug}_*/` directory) — killing the bridge mid-call
will fail that node's request.

## Modes

- **CLI mode** (default, no `ANTHROPIC_API_KEY`) — `claude -p ... --dangerously-skip-permissions`,
  draws from the Claude Max/Pro subscription's rolling 5-hour usage window.
- **API mode** (`ANTHROPIC_API_KEY` set) — calls the Anthropic API directly with
  prompt caching on the system message; uses API credits instead of the subscription.

## Usage-limit detection

When the CLI's rolling usage window is exhausted, `parse_usage_limit()` detects it
(via the `Claude AI usage limit reached|<unix_ts>` marker, or a text fallback that
assumes +5h) and the response becomes:

```json
{
  "output": "",
  "exitCode": 1,
  "error": "usage_limit",
  "retryAfter": "2026-06-11T18:00:00+00:00",
  "rawError": "<original stderr/stdout, for debugging>"
}
```

n8n's Phase 1/2/3 Parse/Save nodes check for `error === "usage_limit"` and pause
the episode (`.status = "paused_until"` + `.paused_until` file) instead of failing
outright — see `(C) 2026-06-11 Usage-Limit Pause + Resume (Step 2 - n8n + Web UI)`
in the vault's iteration logs.

## Endpoints

- `POST /generate` — `{ prompt, system?, model?, max_tokens?, effort?, output_path? }`
  → `{ output, exitCode, error, retryAfter? }`
- `POST /transcribe` — `{ audio_path, output_base? }` → whisper-cli word-level transcript
