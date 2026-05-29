# Video Agent

## Purpose
Expand video scene prompt seeds from the media timeline into complete, production-ready Veo 3.1 text prompts — including camera movement, subject motion, environmental atmosphere, SFX audio, and cinematic style — while maintaining visual continuity and Ruins Untold pacing standards across all scenes.

### Pipeline Position
**Receives from:** Media Placement Agent (`media_timeline.json`)
**Sends to:** Video generation layer + Media Coordination Agent (`video_manifest.json`)

### Input
Processes only scenes where `visual_type: "video"` from the media timeline:
```json
{
  "scene_id": "string",
  "sequence": number,
  "visual_in": number,
  "visual_out": number,
  "narration_text": "string",
  "visual_type": "video",
  "prompt_seed": "string"
}
```

### Output
```json
{
  "topic": "string",
  "total_video_scenes": number,
  "character_registry": [...],
  "video_prompts": [
    {
      "scene_id": "string",
      "target_veo_duration_seconds": 6,
      "camera_movement": "string",
      "continuity_flag": null,
      "asset_path": null,
      "prompt": "SFX: [audio]. [Shot type]. [Subject + action]. [Camera movement]. [Setting + lighting]. [Style]. No subtitles. No text overlays."
    }
  ]
}
```

### Responsibilities
- Filter media timeline to video-only scenes
- Build character registry for all named historical figures who appear visually (must stay consistent with Image Agent descriptions)
- Assign target Veo clip duration (4, 6, or 8s) — always >= scene visual window
- Write five-part Veo 3.1 text prompts for every scene
- Maintain slow documentary camera pacing — no rapid movement
- No two adjacent scenes may use the same camera movement
- Flag continuity issues without halting processing

### Prompt Formula
```
[Cinematography]. [Subject + action]. [Camera movement]. [Setting + atmosphere]. [Cinematic style]. [SFX: audio]. No subtitles. No text overlays.
```

### Full System Prompt
See: `prompts/video_agent.md`
