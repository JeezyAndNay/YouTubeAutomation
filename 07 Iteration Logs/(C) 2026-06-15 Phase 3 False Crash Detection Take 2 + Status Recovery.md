---
tags: [iteration-log, phase3, n8n, bugfix]
project: The Ruins Untold
date: 2026-06-15
---

# Phase 3 False Crash Detection (Take 2) + Status Recovery — 2026-06-15

## Symptom

Episode `sweet_potatoes_and_stone_walls_easter_island__202606141315` (Easter Island —
"Sweet Potatoes and Stone Walls") had its Phase 3 n8n execution finish in ~2.5 minutes
and report the episode as **`"error"`**, while `render.js` (PID 23194) kept running
healthily in the background for another ~78 minutes and finished the render
successfully.

This is the same family of bug as
[[07 Iteration Logs/(C) 2026-06-13 Phase 3 Render Tracking Fix]] (false crash
detection), but the 6/13 fix had already addressed the *first-poll* false positive.
This time it hit on the **second** poll (~150s after launch).

## Root Cause

`Check Render`'s crash-detection relies entirely on:

```js
try {
  const pid = parseInt(fs.readFileSync(vars.renderPidPath, 'utf-8').trim(), 10);
  if (!isNaN(pid)) process.kill(pid, 0);
} catch (e) {
  processAlive = false;
}
const crashed = !isComplete && !processAlive && renderCheckAttempts > 1;
```

Confirmed via n8n execution 421:
- Poll #1 (renderAttempts=1, +90s): `crashed: false` (skip applies, correct).
- Poll #2 (renderAttempts=2, +150s): `crashed: true` — **even though `render.log`
  showed `render.js` actively writing scene 12/180 at that exact timestamp**, and PID
  23194 was independently confirmed alive (and still alive 38+ minutes later).

So `process.kill(pid, 0)` threw against a verifiably-alive PID. I could not reproduce
the throw on demand (manual `process.kill(23194, 0)` from inside the n8n container
succeeded with no error), so the exact trigger (likely something timing/sandbox-related
in how n8n's task-runner process resolves `process.kill` for a sibling process) remains
unconfirmed. But the result was unambiguous: `Render Crashed? → true` → `Handle Phase 3
Error` → `Notify Web UI: Phase 3 Error` (`PATCH /api/episodes/{slug}/status`,
`{"status": "error"}`) → workflow execution ends (shown as "Succeeded" in n8n's
execution list, since the workflow itself didn't throw — it just ran its error branch).

**Compounding problem**: once that execution exits, nothing is polling anymore. When
`render.js` finishes for real and writes `render_complete.json`, there's no running
workflow left to call `Notify Web UI: Phase 3 Complete`. The episode's `.status` file
would have stayed `"error"` forever without manual intervention.

## Fix Applied

`workflows/ruins_untold_v2_phase3.json` — `Check Render` node hardened:

`crashed` now requires **both**:
1. `process.kill(pid, 0)` fails (PID file missing/unparseable, or process genuinely
   gone), **and**
2. `render.log` has not been modified in the last 90s (`STALE_THRESHOLD_MS`) — i.e.
   nothing is actively writing output.

A single flaky `process.kill` result can no longer flip a healthy, actively-rendering
episode to `"error"`. The crash check (both halves) is still skipped entirely on the
first poll, same as the 6/13 fix.

Also added diagnostics: `killCheckNote` (records *why* the PID check passed/failed,
including `e.code`/`e.message`) and `logAgeMs`, both logged via `console.log` /
`console.warn` / `console.error` depending on outcome — so if this recurs again, the
n8n execution log will show the actual exception instead of requiring guesswork.

### Deployment

```bash
docker cp workflows/ruins_untold_v2_phase3.json n8n-n8n-1:/tmp/ruins_untold_v2_phase3.json
docker exec n8n-n8n-1 n8n import:workflow --input=/tmp/ruins_untold_v2_phase3.json
curl -X POST http://localhost:5678/api/v1/workflows/rU-phase3-v2-2026/activate \
  -H "X-N8N-API-KEY: $(cat /Users/jneal/.n8n_api_key)"
```

Confirmed `active: true`.

## Status Recovery (this episode)

1. Confirmed `render.js` finished on its own: `render_complete.json` —
   `status: "complete"`, `scenes_rendered: 180`, `assets_missing: 0`,
   `output_path: .../renders/final_video.mp4`, duration 1304.27s (~21.7 min).
2. Re-fired `POST /webhook/ruins-untold/phase3` with `{"slug":
   "sweet_potatoes_and_stone_walls_easter_island__202606141315"}` against the
   newly-deployed workflow.
3. Execution 422: `Launch Render` saw `render_complete.json` already exists → skipped
   relaunch → `Check Render` (attempt 1) → `isComplete: true` → `Render Done?` → idea
   sheet marked complete → `Phase 3 Summary` → `Notify Web UI: Phase 3 Complete`
   (`{"status": "done"}`).
4. Episode `.status` confirmed `"done"`.

This re-fire also served as a live smoke test of the deployed fix on the happy path —
clean single-pass completion, no regressions.

## Open Items / Notes

- ✅ Committed and pushed as `360377f` (`fix(phase3): require render.log staleness
  alongside PID check before declaring a render crashed`). Verified the deployed n8n
  workflow (`rU-phase3-v2-2026`, active) contains the `STALE_THRESHOLD_MS`/
  `killCheckNote`/`logAgeMs` changes — fix is live, not just committed.
- The exact cause of the `process.kill(pid, 0)` false throw is still unconfirmed. If
  `killCheckNote` ever logs a specific `e.code` (e.g. `EPERM`) on a future false
  positive, that's the lead to chase — but with the staleness cross-check in place, a
  recurrence should no longer affect the episode's status, only produce a
  `console.warn` in the execution log.
- Consider: should `Handle Assets Not Ready` (from the 6/13 fix) or a new terminal node
  set a distinct "Phase 3 deferred" status rather than leaving `.status` unchanged,
  for cases where Phase 3 fires before Phase 2 is truly done? Still parked from 6/13,
  still relevant.
