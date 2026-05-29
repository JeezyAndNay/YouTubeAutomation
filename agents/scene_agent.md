# Scene Agent

## Purpose
Convert a finished script into a structured visual scene plan — identifying scene boundaries, estimating timing from word counts, assigning visual types, writing prompt seeds, and indexing all locations and characters. Produces the pre-production visual blueprint before audio generation begins.

### Pipeline Position
**Receives from:** Script Agent (`script.md`)
**Sends to:** Media Placement Agent + production planning layer (`scene_manifest.json`)

The scene manifest is a planning document. The Media Placement Agent replaces timing estimates with real word-level audio timestamps at production time.

### Input
A Markdown script from the Script Agent with nine section headers:
`COLD OPEN`, `CHANNEL HOOK`, `ACT 1–5`, `CONCLUSION`, `CALL TO ACTION`, `SCRIPT METADATA`

### Output
```json
{
  "topic": "string",
  "episode_title": "string",
  "total_scenes": number,
  "estimated_total_duration_seconds": number,
  "scenes": [
    {
      "scene_id": "act1_s01",
      "act": "cold_open | hook | act1 | act2 | act3 | act4 | act5 | conclusion | cta",
      "sequence": number,
      "estimated_start_seconds": number,
      "estimated_duration_seconds": number,
      "word_count": number,
      "narration_text": "string",
      "visual_type": "image | video",
      "prompt_seed": "string",
      "location": "string or null",
      "time_period": "string or null",
      "characters": ["string"],
      "visual_flags": ["string"]
    }
  ],
  "location_index": [...],
  "character_index": [...],
  "visual_summary": { ... }
}
```

### Five-Step Process

| Step | Action |
|---|---|
| 1 | Strip Markdown, parse script into 9 acts by section header |
| 2 | Identify scene boundaries using paragraph breaks, semantic shifts, and word count targets |
| 3 | Estimate timing: `word_count / 152 * 60 = seconds`; accumulate start times from 0 |
| 4 | Assign `visual_type` (image or video) and write a 1-3 sentence prompt seed |
| 5 | Build location index, character index, and visual summary stats |

### Scene Sizing Rules
- Target: 13-25 words per scene (5-10 seconds at 152 WPM)
- Minimum: 8 words (4 seconds) -- only at strong semantic breaks
- Maximum: 30 words (12 seconds) -- hard ceiling, always split before this
- Never cut mid-sentence
- Merge paragraphs under 13 words with adjacent content before splitting

### Scene Boundary Triggers
- Every paragraph break (default)
- Location change within a paragraph
- Time period shift within a paragraph
- New named historical figure introduced
- Rhetorical question (keep question + one following sentence together)

### Visual Type Rules
Assign `video`: active motion, ongoing processes, environmental atmosphere, location transitions
Assign `image`: artifacts, portraits, maps, static locations, abstract concepts, scenes under 5 seconds
Max image-to-video ratio: 3:1 -- upgrade image scenes to video if exceeded (establishing shots first)

### Visual Flag Types
- `PERIOD_AMBIGUOUS` -- historical period unclear for costume/setting choices
- `FIGURE_NO_LIKENESS` -- named figure with no known historical appearance
- `SPECULATIVE_CONTENT` -- alternative theory; visuals must not imply fact
- `MULTI_LOCATION` -- narration spans more than one location; pick primary
- `ABSTRACT_CONCEPT` -- no direct visual equivalent; requires symbolic imagery

### Scene ID Scheme
`cold_open_s01` → `hook_s01` → `act1_s01`, `act1_s02` → `act2_s01` → ... → `conclusion_s01` → `cta_s01`

### Full System Prompt
See: `prompts/scene_agent.md`
