# agents/ — not maintained

These files are early per-agent design notes (purpose, I/O contracts, output structure,
responsibilities) written during the initial pipeline buildout (2026-05-29 onward).

**They are not the source of truth and are not kept in sync with `prompts/`.** Most have
drifted significantly — some are thin stubs a fraction of the size of their `prompts/`
counterpart, one (`media_agent.md`) refers to an agent later renamed to
`media_placement_agent.md` in `prompts/`, and `prompts/thumbnail_agent.md` has no
counterpart here at all.

Nothing in the pipeline reads from this directory at runtime — n8n reads the deployed
copies of `prompts/*.md` (see `/Users/jneal/n8n_projects/ruins_untold_system_prompts/`).

For current agent behavior, **read `prompts/<agent>.md`**. These files are kept only as a
historical snapshot of the original design intent.
