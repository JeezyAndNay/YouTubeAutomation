# CLAUDE.md
## Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Repo Is

Source-of-truth for the **Ruins Untold** YouTube automation pipeline. It contains:

- **`agents/`** — agent definitions: purpose, I/O contracts, rules (reference docs)
- **`prompts/`** — full system prompts deployed to n8n (these are what agents actually receive)
- **`workflows/`** — n8n workflow JSON exports (`ruins_untold_v2_phase1.json` is current)
- **`docs/`** — architecture and component documentation

> The `agents/` files describe intent. The `prompts/` files are the actual deployed artifacts. When editing an agent's behavior, update both.

---

## Infrastructure (not in this repo)

| Component | Location | Details |
|---|---|---|
| n8n | `localhost:5678` | Docker · `n8n-custom:latest` (n8n + FFmpeg) |
| Claude Bridge | `http://host.docker.internal:3333/generate` | Python server at `/Users/jneal/n8n_projects/ClaudeBridge/claude-bridge.py` |
| Deployed prompts | `/Users/jneal/n8n_projects/ruins_untold_system_prompts/` | Copied from `prompts/` here |
| Episode output | `/Users/jneal/n8n_projects/{slug}_{yyyymmddhhmi}/` | Written by n8n at runtime |

**After editing any file in `prompts/`**, copy it to the deployed location:
```bash
cp prompts/<agent>.md /Users/jneal/n8n_projects/ruins_untold_system_prompts/<agent>.md
```

---

## Claude Bridge API

All agent calls in n8n go through the bridge. The `system` field is ignored — embed system prompts directly in `prompt`.

```json
// Request
POST http://host.docker.internal:3333/generate
{ "prompt": "<system prompt + user input combined>" }

// Response
{ "output": "...", "exitCode": 0, "error": "" }
```

Bridge modes (set by env var):
- **CLI mode** (default, no `ANTHROPIC_API_KEY`) — uses `claude -p` subprocess, draws from Claude Max/Pro subscription
- **API mode** (`ANTHROPIC_API_KEY` set) — calls Anthropic API directly with prompt caching; uses API credits

Bridge subprocess timeout: **1800s (30 min)**. n8n HTTP node timeout must be set to **1500000ms (25 min)** — always less than the bridge ceiling so the bridge can respond cleanly.

Start/restart the bridge:
```bash
cd /Users/jneal/n8n_projects/ClaudeBridge
python3 claude-bridge.py
```

Check if it's running:
```bash
pgrep -fl claude-bridge
```

---

## n8n Workflow Development

Import a workflow:
```bash
docker exec -i n8n-n8n-1 n8n import:workflow --input=/home/node/.n8n/... 
# Or use the n8n UI: Settings → Import
```

The workflow JSON lives in `workflows/ruins_untold_v2_phase1.json`. After making changes in the n8n UI, export and overwrite this file.

**Diagnose execution errors** — get exact node start/stop times:
```bash
docker exec n8n-n8n-1 tail -f /home/node/.n8n/n8nEventLog.log | grep -i "error\|failed\|started\|finished"
```

### n8n Node Pattern for Agent Calls

Every Claude agent call follows this 3-node pattern:

```
Build Prompt (Code node)
  → reads system prompt from disk + upstream data
  → returns { claudeBody: JSON.stringify({ prompt }) }

Call Claude (HTTP Request node)
  → POST http://host.docker.internal:3333/generate
  → body: ={{ $json.claudeBody }}
  → options.timeout: 1500000   ← REQUIRED on every Claude HTTP node

Parse + Save (Code node)
  → reads vars from Build Prompt node (not from HTTP response item)
  → writes output to disk
  → returns slim item (topic/slug/projectDir only, no large strings)
```

**Critical:** Large outputs (scripts, research JSON) must be written to disk and re-read by downstream nodes. Never carry large strings through n8n item data — it causes serialization issues and inflates execution state.

---

## Pipeline Data Flow

```
Topic (Google Sheet / Form)
  → Research Agent       → scripts/research_package.json
  → Script Agent         → scripts/script.md
  → Voice Agent          → audio/voice_package.json
  → [Kie.ai TTS]         → audio/seg_NNN_*.mp3 → audio/voiceover_final.mp3
  → Media Placement Agent→ scripts/media_timeline.json
  ├── Image Agent        → scripts/image_manifest.json
  └── Video Agent        → scripts/video_manifest.json
  → Metadata Agent       → scripts/metadata_package.json
```

Each agent call takes **30–120 seconds**. The full pipeline takes ~15–25 minutes end to end.

---

## Production Standards

| Parameter | Value |
|---|---|
| Script length | 2,800–3,200 words |
| Narration pace | 145–160 WPM (~20 min runtime) |
| Voice model | ElevenLabs v3 (`eleven_v3`) |
| Voice ID | `4YYIPFl9wE5c4L2eu2Gb` |
| Scene length | 5–10 seconds |
| J-cut lead | 1.5 seconds |
| Cross dissolve | 0.75 seconds |
| Image resolution | 1920×1080 minimum · 16:9 |
| Video clip duration | 4 / 6 / 8 seconds |
| Image model | Nano Banana 2 (NB2) via Kie.ai |
| Video model | Veo 3.1 Lite via Kie.ai |
| Music | Suno via Kie.ai |

---

## Key File Contracts

**`research_package.json`** — output of Research Agent, input to Script Agent

**`voice_package.json`** — segments with `narration_text`, `voice_optimized_text`, timing estimates; each segment is 80–150 words at natural paragraph breaks; max 1 directional tag per segment, max 2 `...` pause markers, max 1 ALL CAPS emphasis per sentence; Act 3 gets zero directional tags

**`media_timeline.json`** — scene layout with `visual_type` (image/video), J-cut timing, music/SFX cues; input to Image Agent (image scenes) and Video Agent (video scenes)

**`image_manifest.json`** — NB2 JSON prompts per scene (see [jsonprompting](https://github.com/JeezyAndNay/jsonprompting))

**`video_manifest.json`** — Veo 3.1 prompts per scene (see [veoprompting](https://github.com/JeezyAndNay/veoprompting))

---

## n8n Docker File Access

The n8n container has restricted file access. Only these host paths are mounted:
- `/Users/jneal/n8n_projects` → `/Users/jneal/n8n_projects`
- `/Users/jneal/Antigravity` → `/Users/jneal/Antigravity`

All episode output and system prompts must live under `/Users/jneal/n8n_projects/`. Do not reference `/Users/jneal/YouTubeAutomation/` from within n8n nodes — that path is not mounted.
