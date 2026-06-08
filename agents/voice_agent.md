# Voice Agent

## Purpose
Transform a finished script into a precisely segmented, TTS-optimized voice package — applying ElevenLabs v3 directional tags, pause markers, word-level emphasis, pronunciation flags, and timing estimates so the narration is ready for generation via the Kie.ai API.

### Pipeline Position
**Receives from:** Script Agent (`script.md`)
**Sends to:** Kie.ai API (ElevenLabs v3) + Media Coordination Agent (`voice_package.json`)

### Voice Settings
- Platform: Kie.ai
- Model: ElevenLabs v3 (`eleven_v3`)
- Voice ID: `4YYIPFl9wE5c4L2eu2Gb`
- Target pace: 145-160 WPM
- Stability: `natural`

### Input
A Markdown script produced by the Script Agent:
```
# [EPISODE TITLE]

## COLD OPEN
[narration]

## CHANNEL HOOK
[narration]

## ACT 1 - [TITLE]
[narration]
...

## SCRIPT METADATA
{ ... }
```

### Output
```json
{
  "topic": "string",
  "voice_id": "4YYIPFl9wE5c4L2eu2Gb",
  "model": "eleven_v3",
  "stability": "natural",
  "total_word_count": number,
  "estimated_total_runtime_seconds": number,
  "segments": [
    {
      "segment_id": "cold_open_01",
      "act": "cold_open | hook | act1 | act2 | act3 | act4 | act5 | conclusion | cta",
      "sequence": number,
      "word_count": number,
      "estimated_duration_seconds": number,
      "narration_text": "string -- clean plain text only",
      "voice_optimized_text": "string -- with tags, pauses, and CAPS emphasis",
      "tags_applied": ["string"],
      "pronunciation_flags": [
        { "word": "string", "phonetic": "string", "substitute": "string or null" }
      ],
      "previous_request_ids": [],
      "request_id": null,
      "audio_file": null
    }
  ]
}
```

### Responsibilities
- Strip all Markdown formatting from the script -- `narration_text` is plain prose only
- Segment into 80-150 word chunks at natural paragraph breaks, never mid-sentence
- Apply approved ElevenLabs v3 tags (`[whispers]`, `[curious]`, `[pause]`, `[awe]`, `[dramatic tone]`) -- max 1 per segment
- Insert `...` pause markers at emotional beats -- max 2 per segment
- Apply ALL CAPS emphasis on single high-impact words -- max 1 per sentence
- Flag ancient names, place names, and archaeological terms with phonetic guides
- Calculate timing estimate per segment: `word_count / 152 * 60 = seconds`
- Chain `previous_request_ids` sequentially -- each segment passes its predecessor's request_id at generation time
- Exclude `[sighs]`, `[exhales]`, `[excited]`, `[laughs]`, sound effect tags, and accent tags entirely
- Act 3 (Official Story) segments receive zero directional tags

### Segment ID Scheme
`cold_open_01`, `cold_open_02` -> `hook_01` -> `act1_01`, `act1_02` -> `act2_01` -> `act3_01` -> `act4_01` -> `act5_01` -> `conclusion_01` -> `cta_01`

### Full System Prompt
See: `prompts/voice_agent.md`
