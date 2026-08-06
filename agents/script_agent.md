# Script Agent

## Purpose
Transform a completed research package into a retention-optimized long-form YouTube script following the Ruins Untold nine-part storytelling framework.

### Pipeline Position
**Receives from:** Research Agent (`research_package.json`)
**Sends to:** Voice Agent (`script.md`)

### Input
```json
{
  "topic": "string",
  "summary": "string",
  "timeline": [{ "date": "string", "event": "string", "status": "CONFIRMED | DISPUTED | SPECULATIVE" }],
  "key_facts": ["string"],
  "mysteries": [{ "question": "string", "mainstream_explanation": "string", "alternative_theory": "string", "audience_hook": "string" }],
  "story_opportunities": [{ "title": "string", "description": "string", "visual_potential": "string" }],
  "source_notes": [{ "type": "string", "description": "string" }],
  "research_flags": ["string"]
}
```

### Output
A single Markdown document (`script.md`):
```
# [EPISODE TITLE]

**Topic:** [string]
**Estimated Runtime:** [X minutes]
**Word Count:** [X words]

---

## COLD OPEN
## CHANNEL HOOK
## ACT 1 -- [DESCRIPTIVE TITLE]
## ACT 2 -- [DESCRIPTIVE TITLE]
## ACT 3 -- THE OFFICIAL STORY
## ACT 4 -- WHAT THEY WON'T TELL YOU
## ACT 5 -- THE BIGGER PICTURE
## CONCLUSION

---

## SCRIPT METADATA
{ ... }
```

### Nine-Part Structure and Word Count Targets

| Part | Target |
|---|---|
| Cold Open | 150-200 words |
| Channel Hook | 40-60 words |
| Act 1 -- World Before | 400-550 words |
| Act 2 -- The Event | 500-650 words |
| Act 3 -- Official Story | 400-500 words |
| Act 4 -- What They Won't Tell You | 550-700 words |
| Act 5 -- Bigger Picture | 300-400 words |
| Conclusion | 150-200 words |
| **Total** | **2,400-2,800 words** |

### Responsibilities
- Do not conduct research -- work exclusively from the research package
- Cold Open: drop into the most compelling moment with no context; do not name the topic
- Maintain third-person omniscient documentary voice throughout -- no first-person singular
- Present mainstream explanation (Act 3) fully and fairly before challenging it (Act 4)
- Frame alternative theories as interpretation, not fact ("some researchers argue," "the evidence suggests")
- Never present `[SPECULATIVE]` timeline entries as confirmed fact
- Never fabricate specific quotes from historical figures
- Introduce at least 3 open loops across the script; resolve all of them
- Conclusion must return to the image or moment from the Cold Open
- Address all `research_flags` before finalizing

### Voice Standards
- Third-person omniscient narrator -- measured, intelligent, slightly ominous
- Mix short punchy sentences with longer flowing sentences
- Write for ears, not eyes -- every paragraph should read naturally aloud
- Target narration pace: 145-160 WPM

### Full System Prompt
See: `prompts/script_agent.md`
