1. System Overview
# Architecture Overview

The system converts a single topic prompt into a fully produced
20-minute YouTube video.

Primary Orchestrator:
- n8n

AI Orchestration Layer:
- Claude Code

Generation Services:
- Kie.ai
- ElevenLabs
2. Agent Definitions
Define each Claude Code agent separately:
# Research Agent

Purpose:
Gather factual information and narrative opportunities.

Input:
- Topic
- Audience
- Runtime

Output:
research_package.json
# Script Agent

Purpose:
Generate long-form retention-focused script.

Framework:
Ruins Untold

Output:
script.md
And similarly for:
Scene Agent
Image Prompt Agent
Video Prompt Agent
Voice Agent
Media Coordination Agent
3. Data Flow
Prompt
 ↓
Research
 ↓
Script
 ↓
Scene Extraction
 ↓
Image + Video + Voice Generation
 ↓
Asset Validation
 ↓
Timeline Assembly
 ↓
Final Render
 ↓
Metadata Creation
4. File Contracts
One of the biggest time-savers is documenting the exact JSON passed between agents.
Example:
{
 "scene_id": "scene_01",
 "start_time": 0,
 "end_time": 12,
 "narration": "The city vanished almost overnight...",
 "visual_type": "video",
 "visual_prompt": "",
 "asset_path": ""
}
5. Prompt Sources
Document where each prompting methodology comes from:
## Script Prompts

Source:
https://github.com/JeezyAndNay/skills/blob/main/Ruins_Untold/ruins_untold_script_node.md

Purpose:
Long-form retention-focused storytelling.
## Image Prompts

Source:
https://github.com/JeezyAndNay/jsonprompting

Target Model:
Nano Banana 2
## Video Prompts

Source:
https://github.com/JeezyAndNay/veoprompting

Target Model:
Veo 3.1 Lite
6. Production Standards
This is the section most people forget.
Document things such as:
Target Runtime:
18-22 minutes

Average Scene Length:
5-12 seconds

Image Resolution:
1920x1080 minimum

Video Clips:
5-8 seconds

Voice Model:
ElevenLabs v3

Voice ID:
4YYIPFl9wE5c4L2eu2Gb

Narration Pace:
145-160 WPM

Target Script Length:
3000 words
7. Error Recovery
If image generation fails:
- Retry 3 times
- Regenerate prompt
- Escalate to fallback queue

If voice generation fails:
- Retry 3 times
- Log API response

If render fails:
- Preserve intermediate assets
- Resume from last successful stage
With these documents in place, Claude Code can usually generate and maintain the n8n workflow much more effectively because every agent, data contract, and prompt source is explicitly defined.
