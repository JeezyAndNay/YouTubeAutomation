# Media Placement Agent

## Purpose
Transcribe the completed voiceover MP3 with word-level timestamps, divide it into visual scenes, apply J-cut and transition timing, assign visual types and prompt seeds, and place all music and SFX cues -- producing the master media timeline consumed by every downstream generation agent.

### Pipeline Position
**Receives from:** Voice Agent (`voiceover.mp3`, `voice_package.json`)
**Sends to:** Image Agent, Video Agent, Sound Design Agent, Music Agent (`media_timeline.json`)

### Input
```json
{
  "voiceover_mp3_path": "string",
  "voice_package_path": "string",
  "topic": "string",
  "total_duration_seconds": number
}
```

### Output
```json
{
  "topic": "string",
  "audio_file": "string",
  "total_duration_seconds": number,
  "transcript": { "full_text": "string", "words": [{ "word": "string", "start": number, "end": number, "confidence": number }] },
  "scenes": [
    {
      "scene_id": "string",
      "sequence": number,
      "audio_in": number,
      "audio_out": number,
      "visual_in": number,
      "visual_out": number,
      "narration_text": "string",
      "visual_type": "image | video | pinned_video",
      "prompt_seed": "string or null",
      "transition_in": { "type": "cross_dissolve", "duration": 0.75, "jcut_offset": 1.5 },
      "asset_path": null,
      "include_clip_audio": false,
      "clip_audio_level_db": null
    }
  ],
  "music_cues": [...],
  "sfx_cues": [...],
  "placement_stats": { ... }
}
```

### Six-Step Process

| Step | Action |
|---|---|
| 1 | Transcribe MP3 with word-level timestamps (OpenAI Whisper or equivalent) |
| 2 | Segment transcript into 5-10 second scenes at sentence and semantic boundaries |
| 3 | Apply 1.5s J-cut and 0.75s cross dissolve to every scene boundary |
| 4 | Assign `visual_type` (image or video) and write prompt seed for each scene |
| 5 | Place 5 music cues (intro, investigation, revelation, reflection, outro) at act transitions |
| 6 | Place SFX cues (ambient, punctuation max 6, transition at act breaks) |

### Pinned Scene Rule
Any scene whose `narration_text` contains "Ruins Untold" (the channel intro) is overridden:
- `visual_type`: `pinned_video`
- `asset_path`: `/Users/jneal/Desktop/Youtube/Ruins_Untold/Channel Images/Ruins_Untold_Intro.mp4`
- `prompt_seed`: `null`
- `include_clip_audio`: `true`, `clip_audio_level_db`: `-3`

### J-Cut Timing Rules
- Scene 1: `visual_in = 0` (no J-cut on opening frame)
- All other scenes: `visual_in = audio_in + 1.5`
- All scenes: `visual_out = audio_out + 1.5`
- Cross dissolve window: `visual_in ± 0.375s`

### Visual Type Assignment
Assign `video` when narration describes active motion, ongoing processes, or environmental atmosphere.
Assign `image` when narration describes artifacts, portraits, maps, static locations, or abstract concepts.
Enforce a maximum 3:1 image-to-video ratio -- upgrade image scenes to video if exceeded.

### Music Cues (5 Total)
| Cue | Timing | Mood |
|---|---|---|
| `music_intro` | 0s to Act 1 | Mysterious, atmospheric, ambient drone |
| `music_investigation` | Act 1 to Act 3 end | Tense, investigative, low strings |
| `music_revelation` | Act 4 | Dramatic, unsettling swell |
| `music_reflection` | Act 5 to conclusion | Expansive, haunting, sparse |
| `music_outro` | CTA | Fades unresolved, mirrors intro texture |

All music: -20 dB relative to narration, 3s fade in, 4s fade out.

### SFX Cues
- **Ambient**: continuous per location, -28 dB
- **Punctuation**: max 6 per episode at emotional peaks, -12 dB, 1-3 seconds
- **Transition**: at major act breaks only, 0.5s before cut, -15 dB, 1.5-2 seconds

### Full System Prompt
See: `prompts/media_placement_agent.md`
