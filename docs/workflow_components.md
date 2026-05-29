Workflow Components
1. Topic Intake
Input
A detailed topic prompt including:
Subject
Target audience
Tone
Runtime target
Style requirements
Output
Structured project brief.

2. Research Agent
Purpose
Gather factual information, narrative structure, and supporting context.
Powered By
Claude Code
Deliverables
Research package
Timeline
Key facts
Source references
Story opportunities

3. Script Creation Agent
Purpose
Generate a retention-focused long-form YouTube script.
Framework
Ruins Untold storytelling methodology.
Reference:
https://github.com/JeezyAndNay/skills/blob/main/Ruins_Untold/ruins_untold_script_node.md
Deliverables
Introduction
Hooks
Story segments
Transitions
Conclusion
CTA
Target Length:
2,500–3,500 words
Target Runtime:
Approximately 20 minutes

4. Scene Extraction Agent
Purpose
Convert script into visual scenes.
Responsibilities
Identify scene boundaries
Extract visual descriptions
Determine image/video requirements
Create timing information
Deliverables
Scene manifest
Timing map
Visual requirements

5. Image Prompt Generation Agent
Purpose
Create image prompts optimized for Nano Banana 2.
Framework
Reference repository:
https://github.com/JeezyAndNay/jsonprompting
Requirements
Cinematic composition
Consistent character descriptions
Historical accuracy
Visual continuity
High detail
Deliverables
JSON image prompts
Scene image manifest

6. Video Prompt Generation Agent
Purpose
Create motion prompts optimized for Veo 3.1 Lite.
Framework
Reference repository:
https://github.com/JeezyAndNay/veoprompting
Requirements
Camera movement
Subject motion
Environmental effects
Cinematic realism
Narrative continuity
Deliverables
Veo video prompts
Shot list
Motion instructions

7. Voiceover Generation Agent
Purpose
Generate narration audio.
Platform
Kie.ai
Model
ElevenLabs v3
Voice ID
4YYIPFl9wE5c4L2eu2Gb
Additional Processing
Pronunciation review
Emphasis optimization
Pacing adjustments
Pause insertion
Deliverables
Narration audio
Timestamps
Segment mapping

8. Media Coordination Agent
Purpose
Synchronize all generated assets.
Responsibilities
Match narration to visuals
Verify timing
Ensure continuity
Resolve missing assets
Deliverables
Master timeline
Asset map
Render package

9. Sound Design Agent
Purpose
Generate and place sound effects.
Platform
ElevenLabs SFX
Deliverables
Ambient effects
Transition effects
Scene enhancement effects

10. Final Production Agent
Purpose
Generate final deliverables.
Outputs
Final MP4
Thumbnail assets
Script archive
Narration archive
Metadata package

Claude Code Responsibilities
Claude Code serves as the orchestration intelligence layer.
Responsibilities include:
Research
Script generation
Scene extraction
Voiceover analysis
Asset location tracking
Prompt generation
Workflow validation
Error handling
Metadata creation

Deliverables
Primary
Final YouTube video
Full script
Voiceover audio
Thumbnail assets
Publishing Package
Title
Description
Tags
Chapters
Hashtags
Internal Assets
Research package
Prompt archive
Scene manifest
Asset inventory
Workflow logs

Success Criteria
Single-prompt video generation
Minimal manual intervention
Consistent visual quality
Consistent narration quality
End-to-end automation
Scalable production workflow

Future Enhancements
Phase 2
Automated thumbnail selection
Direct YouTube upload
Multi-channel support
Phase 3
Analytics feedback loop
Prompt optimization system
Automated A/B testing
Multi-language video production
Phase 4
Fully autonomous channel management
Content scheduling
Performance-driven topic selection
Revenue optimization workflows

