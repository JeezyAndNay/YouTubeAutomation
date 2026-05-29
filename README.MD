# The Ruins Untold — YouTube Automation Pipeline

> One prompt. One n8n workflow. One fully produced 20-minute YouTube video.

This repository contains the complete AI-driven production pipeline for **The Ruins Untold** — a faceless YouTube channel covering ancient mysteries, forbidden archaeology, and alternative history. The system transforms a single topic prompt into a finished video: script, voiceover, images, video clips, sound design, and a full YouTube publishing package.

---

## How It Works

```
Topic Prompt
    │
    ▼
Research Agent ──────────────► research_package.json
    │
    ▼
Script Agent ────────────────► script.md  (2,800–3,200 words, 9-part structure)
    │
    ▼
Voice Agent ─────────────────► voice_package.json  (ElevenLabs v3 segments)
    │
    ▼
Media Placement Agent ───────► media_timeline.json  (J-cuts, scene layout, cues)
    │
    ├──────────────────────────► Image Agent ──► image_manifest.json (NB2 prompts)
    │
    └──────────────────────────► Video Agent ──► video_manifest.json (Veo 3.1 prompts)
    │
    ▼
Metadata Agent ──────────────► metadata_package.json
    │
    ▼
Final Render + Publishing Package
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Workflow Orchestration | [n8n](https://n8n.io) (Docker, custom image with FFmpeg) |
| AI Orchestration | Claude Code (via Python bridge server) |
| Script Generation | Claude Code + Ruins Untold storytelling framework |
| Image Generation | [Kie.ai](https://kie.ai) → Nano Banana 2 |
| Video Generation | [Kie.ai](https://kie.ai) → Veo 3.1 Lite |
| Voiceover | [Kie.ai](https://kie.ai) → ElevenLabs v3 |
| Sound Effects | ElevenLabs SFX |
| Music | Kie.ai → Suno |
| Final Assembly | FFmpeg (inside n8n Docker container) |

---

## Agent Definitions

### Research Agent
Gathers factual information, narrative structure, and story opportunities from a topic prompt.

- **Input:** `{ "topic": "...", "audience": "...", "runtime": 20 }`
- **Output:** `research_package.json` — timeline, key facts, mysteries, source notes
- **Powered by:** Claude Code

---

### Script Agent
Generates a retention-focused, long-form YouTube script following the Ruins Untold 9-part structure.

- **Input:** `research_package.json`
- **Output:** `script.md`
- **Target:** 2,800–3,200 words · 145–160 WPM → ~20 minutes
- **Framework:** [ruins_untold_script_node.md](https://github.com/JeezyAndNay/skills/blob/main/Ruins_Untold/ruins_untold_script_node.md)

**Script Structure:**
1. Cold Open
2. Channel Hook
3. Act 1 — The Discovery
4. Act 2 — The Evidence
5. Act 3 — The Official Story
6. Act 4 — What They're Not Telling You
7. Act 5 — The Deeper Pattern
8. Conclusion
9. CTA

---

### Voice Agent
Converts the script into a TTS-optimized voice package with ElevenLabs v3 directional tags, pause markers, emphasis, and phonetic guides.

- **Input:** `script.md`
- **Output:** `voice_package.json` (segments with `narration_text`, `voice_optimized_text`, timing estimates)
- **Voice:** ElevenLabs v3 · Voice ID: `4YYIPFl9wE5c4L2eu2Gb` · Stability: `natural`
- **Chunk size:** 80–150 words per segment at natural paragraph breaks

**Tag rules:**
- Max 1 directional tag per segment (`[whispers]`, `[sighs]`, `[exhales]`, `[curious]`)
- Max 2 `...` pause markers per segment
- Max 1 ALL CAPS emphasis word per sentence
- Act 3 (Official Story) receives zero directional tags

---

### Media Placement Agent
Analyzes the final voiceover and voice package to build a master scene timeline with J-cuts, music cues, and SFX placements.

- **Input:** `voiceover_final.mp3` + `voice_package.json`
- **Output:** `media_timeline.json` — scene layout, visual type (image/video), J-cut timing, music/SFX cues
- **Scene timing:** 5–10s scenes · 1.5s J-cut lead · 0.75s cross dissolve

---

### Image Agent
Creates cinematic, historically accurate image prompts optimized for Nano Banana 2.

- **Input:** `media_timeline.json` (image scenes only)
- **Output:** `image_manifest.json` — NB2 JSON prompts
- **Resolution:** 1920×1080 minimum · 16:9
- **Framework:** [jsonprompting](https://github.com/JeezyAndNay/jsonprompting)

---

### Video Agent
Creates motion-driven video prompts optimized for Veo 3.1 Lite.

- **Input:** `media_timeline.json` (video scenes only)
- **Output:** `video_manifest.json` — Veo 3.1 prompts with camera movement, subject motion, environmental effects
- **Clip lengths:** 4s / 6s / 8s
- **Framework:** [veoprompting](https://github.com/JeezyAndNay/veoprompting)

---

### Metadata Agent
Generates the full YouTube publishing package from the finished script and research.

- **Input:** `script.md` + `research_package.json` + `voice_package.json`
- **Output:** `metadata_package.json` — title, description, tags, chapters, hashtags

---

## Episode Output Structure

Each episode is written to a timestamped folder:

```
/Users/jneal/n8n_projects/{slug}_{yyyymmddhhmi}/
├── scripts/
│   ├── research_package.json
│   ├── script.md
│   ├── media_placement.json
│   ├── image_manifest.json
│   ├── video_manifest.json
│   └── metadata_package.json
├── audio/
│   ├── voice_package.json
│   ├── seg_001_cold_open_01.mp3
│   └── voiceover_final.mp3
├── images/
│   └── image_0001.jpg, ...
├── videos/
│   └── video_0001.mp4, ...
├── clips/
│   └── clip_XXXXX_YYYY.mp4     ← FFmpeg processed
├── music/
└── sfx/
```

---

## Infrastructure

| Component | Details |
|---|---|
| n8n | Docker · `localhost:5678` · Image: `n8n-custom:latest` (n8n + FFmpeg) |
| Claude Bridge | Python server · `http://host.docker.internal:3333/generate` |
| Bridge API | `POST { "prompt": "..." }` → `{ "output": "...", "exitCode": 0 }` |
| n8n volumes | `/Users/jneal/n8n_projects` · `/Users/jneal/Antigravity` |
| System prompts | `/Users/jneal/n8n_projects/ruins_untold_system_prompts/` |

> **Note:** The Claude bridge ignores the `system` field — embed system prompts directly in `prompt`. Each agent call takes 30–120 seconds. Design n8n workflows with generous timeouts.

---

## Repository Structure

```
YouTubeAutomation/
├── agents/               ← Agent definitions (purpose, I/O contracts, rules)
│   ├── research_agent.md
│   ├── script_agent.md
│   ├── voice_agent.md
│   ├── scene_agent.md
│   ├── image_agent.md
│   ├── video_agent.md
│   ├── media_agent.md
│   └── metadata_agent.md
├── prompts/              ← Full system prompts deployed to n8n
│   ├── research_agent.md
│   ├── script_agent.md
│   ├── voice_agent.md
│   ├── scene_agent.md
│   ├── image_agent.md
│   ├── video_agent.md
│   ├── media_placement_agent.md
│   └── metadata_agent.md
├── workflows/
│   └── ruins_untold_phase1.json   ← n8n workflow export
├── docs/
│   ├── architecture.md
│   ├── workflow_components.md
│   └── project_information.md
└── README.MD
```

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
| Image resolution | 1920×1080 minimum |
| Video clip duration | 4 / 6 / 8 seconds |
| Voice model | ElevenLabs v3 (`eleven_v3`) |
| Voice ID | `4YYIPFl9wE5c4L2eu2Gb` |

---

## Error Recovery

| Failure | Recovery |
|---|---|
| Image generation fails | Retry 3×, regenerate prompt, escalate to fallback queue |
| Voice generation fails | Retry 3×, log API response |
| Render fails | Preserve intermediate assets, resume from last successful stage |

---

## Roadmap

**Phase 2**
- Automated thumbnail generation and selection
- Direct YouTube upload via API
- Multi-channel support

**Phase 3**
- Analytics feedback loop
- Prompt optimization from performance data
- Automated A/B testing
- Multi-language video production

**Phase 4**
- Fully autonomous channel management
- Performance-driven topic selection
- Revenue optimization workflows

---

## Related Repositories

| Repo | Purpose |
|---|---|
| [JeezyAndNay/skills](https://github.com/JeezyAndNay/skills) | Claude Code skills including the Ruins Untold script framework |
| [JeezyAndNay/jsonprompting](https://github.com/JeezyAndNay/jsonprompting) | Nano Banana 2 JSON prompting framework |
| [JeezyAndNay/veoprompting](https://github.com/JeezyAndNay/veoprompting) | Veo 3.1 Lite prompting framework |
