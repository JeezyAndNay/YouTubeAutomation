# Image Agent

## Purpose
Expand image scene prompt seeds from the media timeline into full Nano Banana 2 JSON image prompts, maintaining visual continuity and Ruins Untold style standards across all scenes.

### Pipeline Position
**Receives from:** Media Placement Agent (`media_timeline.json`)
**Sends to:** Image generation layer + Media Coordination Agent (`image_manifest.json`)

### Input
Processes only scenes where `visual_type: "image"` from the media timeline:
```json
{
  "scene_id": "string",
  "sequence": number,
  "visual_in": number,
  "visual_out": number,
  "narration_text": "string",
  "visual_type": "image",
  "prompt_seed": "string"
}
```

### Output
```json
{
  "topic": "string",
  "total_image_scenes": number,
  "character_registry": [...],
  "image_prompts": [
    {
      "scene_id": "string",
      "prompt": {
        "goal": "string",
        "subject": ["string"],
        "context": "string",
        "style": "photorealistic, hyper-detailed, cinematic, documentary archaeology",
        "composition": "string",
        "lighting": "string",
        "color_palette": ["string"],
        "background": "string",
        "camera_or_lens": { "focal_length": "string", "aperture": "string", "type": "string" },
        "mood": "string",
        "text_space": "none",
        "negative_constraints": ["string"]
      },
      "asset_path": null
    }
  ]
}
```

### Responsibilities
- **Hard prohibition: never generate a diagram, map with labels, chart, infographic, or annotated/comparative graphic with text callouts.** AI image models cannot reliably render legible text and will produce garbled gibberish (confirmed on Puma Punku and Nan Madol, Aug 2026). `text_space` is always `"none"`. See full rule in `prompts/image_agent.md`.
- Filter media timeline to image-only scenes
- Build character registry for all named historical figures to ensure consistent appearance across scenes
- Expand each `prompt_seed` into a complete Nano Banana 2 JSON prompt
- Apply Ruins Untold visual standards (channel color palette, cinematic lighting, documentary style)
- Match camera/lens profile to content type (wide for ruins, macro for artifacts, environmental for figures)
- Flag continuity issues without halting processing

### Full System Prompt
See: `prompts/image_agent.md`
