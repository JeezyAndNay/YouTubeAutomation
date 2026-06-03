# Ruins Untold — YouTube Automation Pipeline

> One topic. One n8n workflow. One fully produced 20-minute YouTube video.

The **Ruins Untold** automation pipeline transforms a single topic prompt into a complete YouTube episode — script, voiceover, AI-generated images and video, sound design, metadata, and thumbnail. Everything is orchestrated from a Next.js control panel that talks directly to n8n via webhooks.

---

## Web UI

The pipeline ships with a full-featured production dashboard built on Next.js 16 + React 19.

### Episode Dashboard

```
http://localhost:3000
```

Lists every episode folder found in `n8n_projects/`. For each episode you get:
- **Phase indicator** — automatically detected from which output files are present on disk
- **Status** — idle, running (live pulse), awaiting review, done, error, or rejected
- **Inline status selector** — update status without leaving the list
- **One-click drill-through** to the episode detail view

**Start Phase 1** button in the top-right opens a form to kick off a new episode immediately.

### Episode Detail

Two-column layout with full artifact inspection and phase controls:

```
Left panel                        Right panel
─────────────────────────────     ─────────────────────────────
Artifacts (by phase)              Artifact preview
  Phase 1                           - JSON: syntax-highlighted
    ✓ Research                      - Markdown: rendered headings
    ✓ Script                        - Audio: inline player
    ✓ Voice Package               
  Phase 2                         
    ✓ Media Timeline              
    ✓ Image Manifest              
    ✓ Video Manifest              
    ✓ Voiceover (MP3)             
  Phase 3                         
    ○ Metadata                    

Actions
  [ Start Phase 2 ]               
  [ Reject ]                      

Files
  audio/  seg_001.mp3  1.2 MB     
         voiceover_final.mp3  ...
  images/ ...
```

- Selecting an artifact fetches and renders it instantly — no page reload
- While an episode is `running`, the page auto-refreshes every 5 seconds
- **Start Phase 2 / Start Phase 3** — triggers the corresponding n8n webhook and sets status to `running`

### Idea Catalog

```
http://localhost:3000/ideas
```

Full Google Sheets integration for the ideas backlog:
- Filter by status: New, Queued, In Progress, Done, Rejected
- Full-text search across topic, angle, and notes
- Inline editing — click any cell to edit topic, angle, or notes (saved back to Sheets)
- **Promote** — one click converts an idea into a new episode folder and navigates to it
- **Generate Ideas** — fires an n8n webhook that uses Claude to generate new episode ideas and writes them to the Sheet

---

## Pipeline Architecture

```
Topic (Web UI / Google Sheets)
        │
        ▼
 ┌─────────────┐
 │  Phase 1    │
 │             │
 │  Research ──┼──► research_package.json
 │  Script   ──┼──► script.md  (2,800–3,200 words)
 │  Voice    ──┼──► voice_package.json
 │  Voiceover──┼──► voiceover_final.mp3  (ElevenLabs v3)
 └─────────────┘
        │  (Web UI: Start Phase 2)
        ▼
 ┌─────────────┐
 │  Phase 2    │
 │             │
 │  Media    ──┼──► media_timeline.json  (J-cuts, cues, scene layout)
 │  Image    ──┼──► image_manifest.json  (NB2 JSON prompts)
 │  Video    ──┼──► video_manifest.json  (Veo 3.1 prompts)
 └─────────────┘
        │  (Web UI: Start Phase 3)
        ▼
 ┌─────────────┐
 │  Phase 3    │
 │             │
 │  Thumbnail──┼──► thumbnail_prompt_N.json
 │  Metadata ──┼──► metadata_package.json
 │  Render   ──┼──► final video (FFmpeg)
 └─────────────┘
```

Each phase is a separate n8n workflow. The web UI triggers phase transitions and polls for completion.

---

## Agents

### Research Agent
Gathers historical facts, narrative structure, and source material from a topic prompt.

- **Input:** `{ "topic": "..." }`
- **Output:** `research_package.json` — timeline, key facts, mysteries, alternative interpretations
- **Runtime:** ~30–60s

### Script Agent
Writes a retention-focused long-form script following the Ruins Untold 9-part storytelling framework.

- **Input:** `research_package.json`
- **Output:** `script.md`
- **Target:** 2,800–3,200 words at 145–160 WPM → ~20 minutes

Script structure:
1. Cold Open
2. Channel Hook
3. Act 1 — The Discovery
4. Act 2 — The Evidence
5. Act 3 — The Official Story
6. Act 4 — What They're Not Telling You
7. Act 5 — The Deeper Pattern
8. Conclusion
9. CTA

### Voice Agent
Converts the script into a TTS-optimized voice package with ElevenLabs v3 directional tags, pause markers, and phonetic guides.

- **Input:** `script.md`
- **Output:** `voice_package.json`
- **Voice:** ElevenLabs v3 · ID `4YYIPFl9wE5c4L2eu2Gb`
- **Segment size:** 80–150 words at natural paragraph breaks
- **Rules:** max 1 directional tag per segment · max 2 `...` pauses · max 1 ALL CAPS emphasis per sentence · Act 3 gets zero directional tags

### Media Placement Agent
Analyzes the final voiceover to build a master scene timeline with J-cuts, music cues, and SFX placements.

- **Input:** `voiceover_final.mp3` + `voice_package.json`
- **Output:** `media_timeline.json`
- **Scene timing:** 5–10s per scene · 1.5s J-cut lead · 0.75s cross dissolve

### Image Agent
Creates cinematic, historically accurate image prompts for Nano Banana 2.

- **Input:** image scenes from `media_timeline.json`
- **Output:** `image_manifest.json` — NB2 JSON prompts
- **Resolution:** 1920×1080 · 16:9
- **Framework:** [jsonprompting](https://github.com/JeezyAndNay/jsonprompting)

### Video Agent
Creates motion-driven prompts for Veo 3.1 Lite.

- **Input:** video scenes from `media_timeline.json`
- **Output:** `video_manifest.json`
- **Clip lengths:** 4s / 6s / 8s
- **Framework:** [veoprompting](https://github.com/JeezyAndNay/veoprompting)

### SFX Agent
Selects and categorizes sound effects to match scene types: ambient, punctuation, transition.

- **Input:** scene data from `media_timeline.json`
- **Output:** SFX cue list embedded in `media_timeline.json`

### Thumbnail Agent
Generates Midjourney-style thumbnail prompts across 5 templates (Revelation Shot, Explorer Face, Split Reveal, Mystery Object, Location Atmosphere).

- **Input:** episode topic + template selection
- **Output:** `thumbnail_prompt_N.json`

### Metadata Agent
Generates the full YouTube publishing package.

- **Input:** `script.md` + `research_package.json` + `voice_package.json`
- **Output:** `metadata_package.json` — title, description, tags, chapters, hashtags

---

## Technology Stack

| Layer | Technology |
|---|---|
| Workflow Orchestration | [n8n](https://n8n.io) (Docker, custom image with FFmpeg) |
| AI Bridge | Python bridge server → Claude Code (CLI subprocess) |
| Script / Agent AI | Claude (via bridge at `localhost:3333`) |
| Web Dashboard | Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query 5 |
| Image Generation | [Kie.ai](https://kie.ai) → Nano Banana 2 |
| Video Generation | [Kie.ai](https://kie.ai) → Veo 3.1 Lite |
| Voiceover | [Kie.ai](https://kie.ai) → ElevenLabs v3 |
| Music | Kie.ai → Suno |
| SFX | ElevenLabs SFX API |
| Final Assembly | FFmpeg (inside n8n Docker container) |
| Idea Management | Google Sheets API |

---

## Infrastructure

| Component | Location |
|---|---|
| n8n | `localhost:5678` · Docker · `n8n-custom:latest` |
| Claude Bridge | `localhost:3333` · `/Users/jneal/n8n_projects/ClaudeBridge/claude-bridge.py` |
| Web UI | `localhost:3000` · `web/` directory |
| System prompts | `/Users/jneal/n8n_projects/ruins_untold_system_prompts/` |
| Episode output | `/Users/jneal/n8n_projects/{slug}_{yyyymmddhhmi}/` |

### Claude Bridge

All n8n agent calls go through a Python bridge that forwards prompts to Claude:

```bash
# Start the bridge
cd /Users/jneal/n8n_projects/ClaudeBridge
python3 claude-bridge.py

# Check if running
pgrep -fl claude-bridge
```

```
POST http://host.docker.internal:3333/generate
{ "prompt": "<system prompt + user input combined>" }

→ { "output": "...", "exitCode": 0, "error": "" }
```

Bridge subprocess timeout: **1800s**. n8n HTTP nodes must use **1500000ms** timeout.

### n8n Docker volumes

Only these host paths are mounted in the container:
- `/Users/jneal/n8n_projects` → `/Users/jneal/n8n_projects`
- `/Users/jneal/Antigravity` → `/Users/jneal/Antigravity`

---

## Episode Output Structure

```
/Users/jneal/n8n_projects/{slug}_{yyyymmddhhmi}/
├── scripts/
│   ├── research_package.json
│   ├── script.md
│   ├── media_timeline.json
│   ├── image_manifest.json
│   ├── video_manifest.json
│   ├── metadata_package.json
│   └── thumbnail_prompt_N.json
├── audio/
│   ├── voice_package.json
│   ├── seg_001_cold_open_01.mp3
│   ├── seg_002_...mp3
│   └── voiceover_final.mp3
├── images/
│   └── image_0001.jpg  ...
├── videos/
│   └── video_0001.mp4  ...
├── clips/
│   └── clip_XXXXX_YYYY.mp4     ← FFmpeg-processed clips
├── music/
│   └── background.mp3
└── sfx/
    ├── sfx_amb_01.mp3  ...
    ├── sfx_punc_01.mp3 ...
    └── sfx_trans_01.mp3 ...
```

---

## Local Setup

### Prerequisites

- Node.js 20+
- Docker (for n8n)
- Python 3 (for Claude bridge)
- Google Cloud credentials with Sheets API access

### Web UI

```bash
cd web
npm install
cp .env.local.example .env.local   # fill in values (see below)
npm run dev
```

Open `http://localhost:3000`.

### Required environment variables (`web/.env.local`)

```
SESSION_SECRET=<random 32+ char string>
N8N_BASE_URL=http://localhost:5678
N8N_PHASE1_WEBHOOK=ruins-untold/phase1
N8N_PHASE2_WEBHOOK=ruins-untold/phase2
N8N_PHASE3_WEBHOOK=ruins-untold/phase3
N8N_IDEAS_GENERATE_WEBHOOK=ruins-untold/ideas-generate
GOOGLE_SHEETS_ID=<your sheet id>
```

### Google Sheets auth

```bash
node web/scripts/google-auth.mjs
```

Follow the OAuth flow. Credentials are saved locally and picked up automatically on the next dev server start.

### n8n

```bash
cd /Users/jneal/docker/n8n
docker compose up -d
```

Import workflows from `workflows/` via the n8n UI (Settings → Import) or:

```bash
cp workflows/ruins_untold_v2_phase1.json /Users/jneal/n8n_projects/
docker exec -i n8n-n8n-1 n8n import:workflow \
  --input=/Users/jneal/n8n_projects/ruins_untold_v2_phase1.json
```

### Deploy system prompts

After editing any file in `prompts/`:

```bash
cp prompts/<agent>.md /Users/jneal/n8n_projects/ruins_untold_system_prompts/<agent>.md
```

---

## Repository Structure

```
YouTubeAutomation/
├── agents/               ← Agent definitions: purpose, I/O contracts, rules
├── prompts/              ← Full system prompts deployed to n8n (source of truth)
├── workflows/            ← n8n workflow JSON exports
│   ├── ruins_untold_v2_phase1.json
│   ├── ruins_untold_v2_phase2.json
│   ├── ruins_untold_v2_phase3.json
│   └── test_thumbnail_nodes.json
├── web/                  ← Next.js production dashboard
│   ├── src/app/
│   │   ├── episodes/     ← Episode list + detail pages
│   │   ├── ideas/        ← Idea catalog (Google Sheets)
│   │   ├── api/          ← REST routes (episodes, ideas, auth)
│   │   └── actions/      ← Server actions (phase triggers, auth)
│   ├── src/components/   ← Sidebar, StatusPill, StatusSelect
│   └── src/lib/          ← episodes.ts, sheets.ts, n8n.ts, session.ts
├── docs/                 ← Architecture and component docs
└── README.MD
```

> `agents/` files describe intent. `prompts/` files are the deployed artifacts. When changing agent behavior, update both.

---

## Production Standards

| Parameter | Value |
|---|---|
| Target runtime | 18–22 minutes |
| Script length | 2,800–3,200 words |
| Narration pace | 145–160 WPM |
| Scene length | 5–10 seconds |
| J-cut lead | 1.5 seconds |
| Cross dissolve | 0.75 seconds |
| Image resolution | 1920×1080 minimum · 16:9 |
| Video clip duration | 4s / 6s / 8s |
| Voice model | ElevenLabs v3 (`eleven_v3`) |
| Voice ID | `4YYIPFl9wE5c4L2eu2Gb` |
| Image model | Nano Banana 2 (NB2) via Kie.ai |
| Video model | Veo 3.1 Lite via Kie.ai |
| Music | Suno via Kie.ai |
| Agent call timeout | 1500000ms (n8n) / 1800s (bridge) |

---

## Related Repositories

| Repo | Purpose |
|---|---|
| [JeezyAndNay/skills](https://github.com/JeezyAndNay/skills) | Claude Code skills including the Ruins Untold script framework |
| [JeezyAndNay/jsonprompting](https://github.com/JeezyAndNay/jsonprompting) | NB2 JSON prompting framework |
| [JeezyAndNay/veoprompting](https://github.com/JeezyAndNay/veoprompting) | Veo 3.1 Lite prompting framework |
