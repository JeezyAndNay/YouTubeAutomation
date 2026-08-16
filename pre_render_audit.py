#!/usr/bin/env python3
"""
Pre-render clip duration audit — The Ruins Untold.

Loads media_timeline.json for an episode, computes every scene's clip
duration using the same formula as render.js, and verifies all clips
fall within the 5–10 second target range.

NOTE (2026-08-13 fix): there are two distinct notions of "duration" here and
they must not be conflated:
  - clip_dur()  — the actual rendered FILE length (content span + the 0.75s
                  XFADE crossfade pad, plus LEAD_IN/TAIL_PAD on the first/last
                  clip). This is what render.js actually outputs to disk and
                  is the correct basis for the auto-fix redistribution math.
  - clip_span() — the underlying CONTENT span (no crossfade/lead-in/tail-pad
                  padding). This is what segment.py's MAX_SCENE=10.0 /
                  TARGET_MIN=5.0 caps actually constrain.
Every middle-clip's clip_dur() is inflated by exactly XFADE_DUR (0.75s) over
its clip_span(). Comparing clip_dur() against the 5-10s target (as this
script previously did) therefore flagged scenes sitting right at segment.py's
legitimate 10.0s cap as "too long" by exactly the crossfade amount — a false
positive, not a real defect. Categorization now uses clip_span(); the
redistribution/auto-fix logic still correctly uses clip_dur() render-space
math, since that's genuinely about rendered-file windows.

Auto-fixes what it can:
  - Windows where a short + long clip pair can be balanced by centering
    an unmatched (non-anchor) scene in its window.

Reports and blocks on what it cannot fix:
  - Clusters where the Whisper-anchored window is simply too narrow
    to give every scene 5+ seconds (script segmentation issue).

Usage:
    python3 pre_render_audit.py <episode_dir>

    episode_dir: full path to the episode folder, e.g.
        /Users/jneal/n8n_projects/olmec_heads_carry_african_faces_who_sailed_fi_202606272342

Exit codes:
    0 — all clips in range (or only unfixable structural issues remain)
    1 — fixable issues remain that were not corrected (should not happen)

Run this AFTER apply_whisper_timing.py and BEFORE render.js.
"""

import json
import os
import sys
import bisect

# ── Constants — must match render.js ─────────────────────────────────────────
XFADE_DUR    = 0.75    # crossfade duration between clips (render.js XFADE_DURATION)
LEAD_IN      = 3.0     # NARRATION_PAUSE + JCUT added to first clip
TAIL_PAD     = 2.0     # extra seconds on the last clip
MIN_TARGET   = 5.0     # target minimum clip duration (seconds)
MAX_TARGET   = 10.0    # target maximum clip duration (seconds)

# Clips shorter than this are flagged as flash-frames regardless of fixability
FLASH_THRESH = 3.0

# ── Load ──────────────────────────────────────────────────────────────────────

if len(sys.argv) < 2:
    print("Usage: python3 pre_render_audit.py <episode_dir>")
    sys.exit(1)

episode_dir   = sys.argv[1].rstrip("/")
timeline_path = os.path.join(episode_dir, "scripts", "media_timeline.json")

if not os.path.exists(timeline_path):
    print(f"ERROR: {timeline_path} not found")
    sys.exit(1)

with open(timeline_path) as f:
    tl = json.load(f)

scenes = tl.get("scenes", [])
n      = len(scenes)

print(f"Pre-render audit: {os.path.basename(episode_dir)}")
print(f"  Scenes: {n}  |  Audio: {tl.get('total_duration_seconds', '?')}s")
print()

# ── Clip duration formula ─────────────────────────────────────────────────────

def clip_dur(k):
    """Compute expected clip duration for scene at index k (0-based)."""
    if k == 0:
        # First clip gets LEAD_IN extension
        if n > 1:
            return scenes[1]["visual_in"] - scenes[0]["visual_in"] + XFADE_DUR + LEAD_IN
        return LEAD_IN + XFADE_DUR
    if k == n - 1:
        # Last clip gets TAIL_PAD extension
        vo = scenes[k].get("visual_out", scenes[k]["visual_in"] + 5.0)
        return vo - scenes[k]["visual_in"] + XFADE_DUR + TAIL_PAD
    return scenes[k + 1]["visual_in"] - scenes[k]["visual_in"] + XFADE_DUR

def clip_span(k):
    """Content span for scene at index k — matches segment.py's world (no
    crossfade pad, no edge lead-in/tail-pad). This is what MAX_SCENE/TARGET_MIN
    in segment.py actually cap, and what the 5-10s target range means."""
    if k == n - 1:
        vo = scenes[k].get("visual_out", scenes[k]["visual_in"] + 5.0)
        return vo - scenes[k]["visual_in"]
    return scenes[k + 1]["visual_in"] - scenes[k]["visual_in"]

# ── Compute all durations ─────────────────────────────────────────────────────

durs  = [clip_dur(k) for k in range(n)]    # rendered FILE length (incl. crossfade pad)
spans = [clip_span(k) for k in range(n)]   # underlying CONTENT span (segment.py's world)

# ── Categorise ───────────────────────────────────────────────────────────────
# Categorised against clip_span(), not clip_dur() — the 5-10s target is a
# content-pacing constraint (segment.py's cap), not a rendered-file-length one.

flash_scenes  = [(k, spans[k]) for k in range(n) if spans[k] < FLASH_THRESH]
short_scenes  = [(k, spans[k]) for k in range(n) if FLASH_THRESH <= spans[k] < MIN_TARGET]
long_scenes   = [(k, spans[k]) for k in range(n) if spans[k] > MAX_TARGET]
ok_scenes     = [(k, spans[k]) for k in range(n) if MIN_TARGET <= spans[k] <= MAX_TARGET]

print(f"Clip content-span distribution (segment.py's world — excludes {XFADE_DUR:.2f}s crossfade pad):")
print(f"  < {FLASH_THRESH:.0f}s  (flash frames)   : {len(flash_scenes):>3}")
print(f"  {FLASH_THRESH:.0f}–{MIN_TARGET:.0f}s (short)         : {len(short_scenes):>3}")
print(f"  {MIN_TARGET:.0f}–{MAX_TARGET:.0f}s (target ✓)    : {len(ok_scenes):>3}")
print(f"  > {MAX_TARGET:.0f}s  (too long)        : {len(long_scenes):>3}")
print(f"  Min: {min(spans):.2f}s  Max: {max(spans):.2f}s  Avg: {sum(spans)/n:.2f}s")
print(f"  (Rendered file lengths incl. crossfade pad — Min: {min(durs):.2f}s  Max: {max(durs):.2f}s  Avg: {sum(durs)/n:.2f}s)")
print()

problems = flash_scenes + short_scenes + long_scenes
if not problems:
    print("✅ All clips in target range. Ready to render.")
    sys.exit(0)

# ── Identify Whisper anchors ──────────────────────────────────────────────────
# An anchor is a scene that has enough narration words to have been Whisper-matched.
# We approximate this: scenes with ≥4 narration words AND whose visual_in is NOT
# at a "suspicious" proportional value are anchors.
#
# For the audit we use a simpler heuristic: scenes whose narration has ≥4 words
# and that appear in neither the flash nor long list are likely anchors.
# This is conservative — we may miss some anchors — but it errs on the side of
# NOT redistributing correctly-placed Whisper scenes.

def token_count(text):
    text = text.lower()
    import re
    text = re.sub(r"[^a-z0-9' ]", " ", text)
    return len([w for w in text.split() if w])

# Best approximation: mark a scene as "anchor-candidate" if narration >= 4 words.
# During redistribution we only move NON-anchor scenes.
anchor_idxs = set()
for i, s in enumerate(scenes):
    nar = s.get("narration_text", "").strip()
    # Scenes with real narration (not just [MUSIC] or empty) and ≥4 words
    # are candidates for Whisper anchoring.  We trust that apply_whisper_timing.py
    # matched most of them — we just need to avoid moving them here.
    if token_count(nar) >= 4:
        anchor_idxs.add(i)

# ── Auto-fix: redistribute unbalanced windows ─────────────────────────────────

print("=== Auto-fix pass ===")
fixed_windows = 0
fixed_scenes  = 0
unfixable     = []   # (scene_id, dur, reason)

# Identify "problem indices" (flash or short) for fast lookup
problem_set = set(k for k, _ in problems)

i_left = 0
while i_left < len(scenes):
    if i_left not in anchor_idxs:
        i_left += 1
        continue

    # Find next anchor
    i_right = i_left + 1
    while i_right < len(scenes) and i_right not in anchor_idxs:
        i_right += 1

    if i_right >= len(scenes):
        break

    n_between = i_right - i_left - 1
    if n_between == 0:
        i_left = i_right
        continue

    # Check if this window contains any problem scene
    window_indices = list(range(i_left, i_right))
    if not any(k in problem_set for k in window_indices):
        i_left = i_right
        continue

    left_vi  = scenes[i_left]["visual_in"]
    right_vi = scenes[i_right]["visual_in"]
    window   = right_vi - left_vi
    n_slots  = n_between + 1
    target   = window / n_slots if n_slots > 0 else 0

    if target < MIN_TARGET:
        # Window too small — redistribution can't reach the target
        for k in range(i_left, i_right):
            cd = durs[k]
            if cd < FLASH_THRESH:
                unfixable.append((
                    scenes[k]["scene_id"], cd,
                    f"structural — {n_between+1} scenes in {window:.2f}s window "
                    f"(target would be {target:.2f}s)"
                ))
        i_left = i_right
        continue

    # Redistribute
    max_dur = max(scenes[k+1]["visual_in"] - scenes[k]["visual_in"] + XFADE_DUR
                  for k in range(i_left, i_right))
    min_dur = min(scenes[k+1]["visual_in"] - scenes[k]["visual_in"] + XFADE_DUR
                  for k in range(i_left, i_right))

    print(f"  Redistributing [{scenes[i_left]['scene_id']} → {scenes[i_right]['scene_id']}]  "
          f"{left_vi:.2f}–{right_vi:.2f}s  ({n_between} intermediate  "
          f"min={min_dur:.1f}s max={max_dur:.1f}s → target={target:.1f}s)")

    for j, k in enumerate(range(i_left + 1, i_right)):
        sc     = scenes[k]
        old_vi = sc["visual_in"]
        old_vo = sc.get("visual_out", old_vi + 5.0)
        dur    = round(max(old_vo - old_vi, 0.5), 3)
        new_vi = round(left_vi + (j + 1) / n_slots * window, 3)
        sc["visual_in"]        = new_vi
        sc["visual_out"]       = round(new_vi + dur, 3)
        sc["duration_seconds"] = dur
        durs[k] = clip_dur(k)   # recompute
        print(f"    {sc.get('scene_id','?')}: {old_vi:.3f} → {new_vi:.3f}s")
        fixed_scenes += 1

    # Recompute the left anchor's clip duration too (it changed)
    durs[i_left] = clip_dur(i_left)
    fixed_windows += 1
    i_left = i_right

if fixed_windows:
    # Verify monotonic ordering
    mono_bad = sum(1 for k in range(1, n)
                   if scenes[k]["visual_in"] <= scenes[k-1]["visual_in"])
    print(f"  Fixed: {fixed_scenes} scenes in {fixed_windows} windows  "
          f"(monotonic violations: {mono_bad})")

    # Save
    with open(timeline_path, "w") as f:
        json.dump(tl, f, indent=2)
    print(f"  Saved: {os.path.basename(timeline_path)}")
else:
    print("  Nothing auto-fixed.")
print()

# ── Re-evaluate after fixes ───────────────────────────────────────────────────

durs  = [clip_dur(k) for k in range(n)]    # recompute after any fixes
spans = [clip_span(k) for k in range(n)]   # recompute after any fixes

remaining_problems = [(k, spans[k]) for k in range(n)
                      if spans[k] < MIN_TARGET or spans[k] > MAX_TARGET]

# ── Final report ──────────────────────────────────────────────────────────────

print("=== Final Report ===")

if unfixable:
    print(f"⚠️  Unfixable (structural — script segmentation):")
    for sid, d, reason in unfixable:
        print(f"    {sid}  {d:.2f}s — {reason}")
    print()

still_short = [(k, d) for k, d in remaining_problems if d < MIN_TARGET and
               scenes[k]["scene_id"] not in {u[0] for u in unfixable}]
still_long  = [(k, d) for k, d in remaining_problems if d > MAX_TARGET]

if still_short or still_long:
    if still_short:
        print(f"❌ Still short after fix attempt ({len(still_short)}):")
        for k, d in still_short:
            print(f"    {scenes[k]['scene_id']}  {d:.2f}s")
    if still_long:
        print(f"❌ Still long after fix attempt ({len(still_long)}):")
        for k, d in still_long:
            print(f"    {scenes[k]['scene_id']}  {d:.2f}s")
    sys.exit(1)
else:
    ok_count = sum(1 for d in spans if MIN_TARGET <= d <= MAX_TARGET)
    print(f"✅ All clips in 5–10s content-span range after fixes.")
    if unfixable:
        print(f"   (Structural flash frames noted above — accept or fix via script re-segmentation)")
    print(f"   {ok_count}/{n} in target  |  min={min(spans):.2f}s  max={max(spans):.2f}s  avg={sum(spans)/n:.2f}s")
    print(f"   (Rendered file lengths incl. crossfade pad — min={min(durs):.2f}s  max={max(durs):.2f}s  avg={sum(durs)/n:.2f}s)")
    sys.exit(0)
