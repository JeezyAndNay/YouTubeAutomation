# Metadata Agent

## Purpose
Generate the complete YouTube publishing package for each episode -- title options, description, chapters, tags, hashtags, and a thumbnail text brief -- optimized for search discovery and click-through rate in the ancient mysteries and alternative history niche.

### Pipeline Position
**Receives from:** Script Agent (`script.md`), Research Agent (`research_package.json`), Voice Agent (`voice_package.json`)
**Sends to:** YouTube publishing layer (`metadata_package.json`)

### Input
```json
{
  "script_path": "string",
  "research_package_path": "string",
  "voice_package_path": "string"
}
```

### Output
```json
{
  "topic": "string",
  "episode_data": {
    "central_mystery": "string",
    "key_anomaly": "string",
    "time_period": "string",
    "key_locations": ["string"],
    "named_figures": ["string"]
  },
  "title_primary": "string",
  "title_alternates": ["string", "string", "string", "string"],
  "description": "string -- full description with all four sections",
  "chapters": [
    { "timestamp": "M:SS", "title": "string", "act": "string" }
  ],
  "tags": "string -- comma-separated, under 500 characters",
  "tag_count": number,
  "tag_character_count": number,
  "hashtags": "string -- space-separated",
  "thumbnail_brief": {
    "primary_text": "string -- 2-4 words, title case",
    "secondary_text": "string or null",
    "image_direction": "string",
    "strategic_rationale": "string"
  }
}
```

### Six-Step Process

| Step | Action |
|---|---|
| 1 | Extract core episode data (mystery, anomaly, hook, figures, locations, time period) |
| 2 | Generate 5 title options using different formulas; select best as `title_primary` |
| 3 | Write 4-section description (hook lines, overview, chapters, footer) |
| 4 | Generate 20-30 tags across 3 tiers -- broad, niche, episode-specific |
| 5 | Generate 3-5 hashtags including `#RuinsUntold` and `#AncientMysteries` |
| 6 | Write thumbnail text brief (primary text, secondary text, image direction, rationale) |

### Title Formulas (5 Options, No Repeats)
- **The Gap**: State a fact, expose the unanswered question
- **The Contradiction**: Official story vs. what the evidence shows
- **The Discovery**: A find that should not exist
- **The Vanishing**: Something disappeared without explanation
- **The Suppression**: Knowledge that exists but is not discussed

Title constraints: max 70 characters, no clickbait fabrications, no generic shock phrases, front-load the most compelling element.

### Description Structure
1. **Hook** (lines 1-3, shown before "Show more"): documentary voice, new angle on the title, ends on unresolved tension
2. **Episode Overview** (2-4 sentences): factual summary of key claims
3. **Chapters**: timestamps derived from `voice_package.json` accumulated segment durations, evocative names not act numbers
4. **Footer**: channel boilerplate, source references from research package, 3 hashtags

### Tags (3 Tiers)
- Tier 1 (always): `ancient mysteries`, `forbidden archaeology`, `alternative history`, `lost civilizations`, `ruins untold`, `suppressed history`, `hidden history`, `ancient history`
- Tier 2 (niche, 3-6): matched to episode category
- Tier 3 (episode-specific, 8-16): topic name variants, locations, named figures, time period

### Thumbnail Brief
- `primary_text`: 2-4 words in title case -- creates curiosity, legible at small size
- `secondary_text`: optional 1-3 word context label
- `image_direction`: 2-3 sentence visual description for the thumbnail workflow
- `strategic_rationale`: names the specific psychological trigger (curiosity gap, dissonance, dread, scale)

### Full System Prompt
See: `prompts/metadata_agent.md`
