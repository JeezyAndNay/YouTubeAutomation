# Music Agent System Prompt — DEPRECATED

**Status: Deprecated 2026-06-13. Merged into `music_sfx.md`.**

This agent was never wired into the Phase 2 n8n workflow — `Prepare Music Request`
only ever read `c.style_prompt` (a short, generic description) with empty `style`/`title`
fields, which is what caused poor Suno output ("trash music"). Rather than adding a
third agent call to Phase 2 (already token-exhaustion-prone), this agent's
responsibilities — expanding cues into full `suno_prompt`/`suno_tags`/`suno_title`/
`negativeTags` — were folded directly into the **Music & SFX Agent**
(`music_sfx.md`), which now produces Suno-ready cues in a single pass. That agent
also added an "Era & Culture Musical Palette" step, mapping each episode's topic to
era/culture-appropriate accent instrumentation.

No node calls this prompt. Kept for historical reference only — do not deploy or
invoke. See `music_sfx.md` for the current music cue generation logic.

---

See [[07 Iteration Logs/(C) 2026-06-13 Music Prompt Pipeline Fix + Era-Culture Palette.md]]
in the vault for the full investigation and rationale (Ruins Untold project).
