#!/usr/bin/env python3
"""
validate_media_timeline.py — Ruins Untold Phase 2 generation-time gate.

Runs IMMEDIATELY after the Media Placement Agent emits media_timeline.json and
BEFORE any asset generation spend (images, video, music, SFX).

This enforces — in code — every rule that currently lives as prose in
ruins_untold_system_prompts/media_placement_agent.md under "Timing Validation
Rules" and "Quality Checklist". An LLM cannot be trusted to self-certify
arithmetic; this script can.

Why this exists (2026-08-10 architecture audit):
  render.js:401  const start = cue.start_time ?? cue.start ?? 0;
  render.js:402  const end   = cue.end_time   ?? cue.end   ?? (start + 60);

  When the agent emits the STALE schema (trigger_at / subtype) instead of the
  current one (start / end / duration), render.js silently defaults every music
  cue to start=0,end=60. Result: all tracks stack in the first minute, then the
  video is silent. No crash, no warning — just a broken render discovered by
  watching it. That is the exact Derinkuyu failure. This script makes that a
  hard, loud, pre-spend failure.

Usage:
    python3 validate_media_timeline.py <episode_dir> [--warn-only] [--json-out PATH]

    episode_dir : full path to episode folder; timeline is read from
                  <episode_dir>/scripts/media_timeline.json

Exit codes:
    0 — timeline valid (warnings may still be printed)
    1 — one or more ERRORS; pipeline must stop before generation spend
    2 — timeline missing or unparseable
"""

import argparse
import json
import os
import sys

# ── Spec constants — must match media_placement_agent.md and render.js ────────
JCUT_OFFSET     = 1.5    # visual_in = audio_in + 1.5 (except scene 1 = 0)
MAX_SCENE_DUR   = 10.0   # hard max, never exceeded
MIN_SCENE_DUR   = 4.0    # target min (warning, not error — short beats happen)
XFADE_DUR       = 0.75
MAX_IMG_VID_RATIO = 3.0  # image:video ratio ceiling
EXPECTED_MUSIC_CUES = 5
MAX_PUNCTUATION_SFX = 6
EPS = 0.02               # float tolerance for timing equality

VALID_VISUAL_TYPES = {"image", "video"}
RETIRED_VISUAL_TYPES = {"pinned_video"}
VALID_SFX_TYPES = {"ambient", "punctuation", "transition"}

# Fields that prove the agent emitted the OLD schema. Presence = hard fail.
STALE_CUE_FIELDS = {"trigger_at", "sfx_type", "start_time", "duration_seconds"}

PLACEHOLDER_MARKERS = ("[narration", "XXX", "x.xx", "TODO", "PLACEHOLDER", "lorem ipsum")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def err(self, code, msg):
        self.errors.append((code, msg))

    def warn(self, code, msg):
        self.warnings.append((code, msg))

    @property
    def ok(self):
        return not self.errors


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ── Scene validation ─────────────────────────────────────────────────────────

def detect_legacy_schema(scenes, rep):
    """
    The agent's scene schema has drifted at least three times with no versioning
    (Paracas 6/12, Gobekli/Olmec 6/27, H-Blocks 7/22). Rather than emitting one
    error per scene for a whole-file schema mismatch, detect it once and say so.

    Returns True if the timeline is a legacy shape and per-scene checks should be
    skipped.
    """
    sample = scenes[0]
    has_audio  = _num(sample.get("audio_in")) and _num(sample.get("audio_out"))
    has_visual = _num(sample.get("visual_in")) and _num(sample.get("visual_out"))

    if has_audio and has_visual:
        return False

    if not has_audio and has_visual:
        rep.err("LEGACY_SCHEMA_NO_AUDIO",
                f"all {len(scenes)} scenes carry visual_in/visual_out but no "
                f"audio_in/audio_out (Gobekli/Olmec-era shape). J-cut arithmetic "
                f"cannot be verified. Regenerate with the current agent.")
    elif has_audio and not has_visual:
        rep.err("LEGACY_SCHEMA_NO_VISUAL",
                f"all {len(scenes)} scenes carry audio_in/audio_out but no "
                f"visual_in/visual_out (Paracas-era shape). render.js needs "
                f"visual_in to place clips. Regenerate with the current agent.")
    else:
        rep.err("LEGACY_SCHEMA_UNKNOWN",
                f"scenes carry neither a complete audio nor visual timing pair; "
                f"keys present: {sorted(sample.keys())}")
    return True


def count_visual_types(scenes):
    n_img = sum(1 for s in scenes if s.get("visual_type") == "image")
    n_vid = sum(1 for s in scenes if s.get("visual_type") == "video")
    return n_img, n_vid


def validate_scenes(tl, rep):
    scenes = tl.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        rep.err("SCENES_MISSING", "timeline has no 'scenes' array")
        return 0, 0

    if detect_legacy_schema(scenes, rep):
        return count_visual_types(scenes)

    total = tl.get("total_duration_seconds")
    if not _num(total):
        total = tl.get("total_audio_duration_seconds")
    if not _num(total):
        rep.err("DURATION_MISSING", "no numeric total_duration_seconds on timeline")
        total = None

    n_img = n_vid = 0
    prev_out = None

    for i, s in enumerate(scenes):
        sid = s.get("scene_id") or f"index_{i}"

        # --- required numeric timing fields ---
        missing = [f for f in ("audio_in", "audio_out", "visual_in", "visual_out")
                   if not _num(s.get(f))]
        if missing:
            rep.err("SCENE_FIELD_MISSING",
                    f"{sid}: missing/non-numeric {', '.join(missing)}")
            continue

        ai, ao = s["audio_in"], s["audio_out"]
        vi, vo = s["visual_in"], s["visual_out"]

        # --- duration bounds ---
        dur = ao - ai
        if dur <= 0:
            rep.err("SCENE_DUR_NONPOSITIVE", f"{sid}: audio_out <= audio_in ({ai} → {ao})")
        elif dur > MAX_SCENE_DUR + EPS:
            rep.err("SCENE_TOO_LONG",
                    f"{sid}: {dur:.2f}s exceeds {MAX_SCENE_DUR}s hard max "
                    f"(audio {ai:.2f}→{ao:.2f})")
        elif dur < MIN_SCENE_DUR - EPS:
            rep.warn("SCENE_SHORT", f"{sid}: {dur:.2f}s is under {MIN_SCENE_DUR}s target")

        # --- J-cut arithmetic ---
        if i == 0:
            if abs(vi - 0.0) > EPS:
                rep.err("SCENE1_VISUAL_IN", f"{sid}: first scene visual_in must be 0, got {vi}")
        else:
            expected_vi = ai + JCUT_OFFSET
            if abs(vi - expected_vi) > EPS:
                rep.err("JCUT_VISUAL_IN",
                        f"{sid}: visual_in {vi:.3f} != audio_in + {JCUT_OFFSET} "
                        f"({expected_vi:.3f})")
        expected_vo = ao + JCUT_OFFSET
        if abs(vo - expected_vo) > EPS:
            rep.err("JCUT_VISUAL_OUT",
                    f"{sid}: visual_out {vo:.3f} != audio_out + {JCUT_OFFSET} "
                    f"({expected_vo:.3f})")

        # --- monotonic / non-overlapping ---
        if prev_out is not None and ai < prev_out - EPS:
            rep.err("SCENE_OVERLAP",
                    f"{sid}: audio_in {ai:.3f} overlaps previous scene's "
                    f"audio_out {prev_out:.3f}")
        prev_out = ao

        # --- coverage against total ---
        if total is not None and ao > total + EPS:
            rep.err("SCENE_PAST_END",
                    f"{sid}: audio_out {ao:.3f} exceeds total duration {total:.3f}")

        # --- visual type ---
        vt = s.get("visual_type")
        if vt in RETIRED_VISUAL_TYPES:
            rep.err("VISUAL_TYPE_RETIRED", f"{sid}: visual_type '{vt}' is retired")
        elif vt not in VALID_VISUAL_TYPES:
            rep.err("VISUAL_TYPE_INVALID",
                    f"{sid}: visual_type '{vt}' not in {sorted(VALID_VISUAL_TYPES)}")
        else:
            if vt == "image":
                n_img += 1
            else:
                n_vid += 1

        # --- prompt seed ---
        seed = (s.get("prompt_seed") or "").strip()
        if not seed and not s.get("asset_path"):
            rep.err("PROMPT_SEED_EMPTY", f"{sid}: empty prompt_seed and no asset_path")
        elif any(m.lower() in seed.lower() for m in PLACEHOLDER_MARKERS):
            rep.err("PROMPT_SEED_PLACEHOLDER", f"{sid}: prompt_seed contains placeholder text")

        # --- narration placeholder check (when present) ---
        nar = s.get("narration_text")
        if isinstance(nar, str) and any(m.lower() in nar.lower() for m in PLACEHOLDER_MARKERS):
            rep.err("NARRATION_PLACEHOLDER",
                    f"{sid}: narration_text contains placeholder text")

        # --- wikimedia consistency ---
        if s.get("real_photo_preferred") and not (s.get("wikimedia_search_query") or s.get("asset_path")):
            rep.warn("WIKIMEDIA_QUERY_MISSING",
                     f"{sid}: real_photo_preferred is true but no wikimedia_search_query")

    # --- final coverage gap ---
    if total is not None and prev_out is not None:
        gap = total - prev_out
        if gap > 1.0:
            rep.err("COVERAGE_GAP",
                    f"last scene ends at {prev_out:.2f}s but audio is {total:.2f}s "
                    f"— {gap:.2f}s of narration has no visual")

    # --- image:video ratio ---
    if n_vid == 0 and n_img:
        rep.warn("NO_VIDEO_SCENES", "timeline contains no video scenes")
    elif n_vid:
        ratio = n_img / n_vid
        if ratio > MAX_IMG_VID_RATIO + 0.01:
            rep.warn("IMG_VID_RATIO",
                     f"image:video ratio {ratio:.2f}:1 exceeds {MAX_IMG_VID_RATIO}:1 "
                     f"({n_img} image / {n_vid} video)")

    return n_img, n_vid


# ── Cue validation (music + SFX) ─────────────────────────────────────────────

def _check_stale(cue, sid, rep, kind):
    """Hard-fail on old-schema fields. This is the Derinkuyu silent-audio bug."""
    stale = STALE_CUE_FIELDS.intersection(cue.keys())
    # duration_seconds is only stale on cues, and only if `duration` is absent
    if "duration_seconds" in stale and "duration" in cue:
        stale.discard("duration_seconds")
    if "start_time" in stale and "start" in cue:
        stale.discard("start_time")
    if stale:
        rep.err("STALE_CUE_SCHEMA",
                f"{kind} {sid}: uses retired field(s) {sorted(stale)} — render.js will "
                f"silently default start=0,end=60 and stack all cues at the head of "
                f"the video")
        return True
    return False


def validate_music(tl, rep, total):
    cues = tl.get("music_cues")
    if not isinstance(cues, list):
        rep.err("MUSIC_MISSING", "timeline has no 'music_cues' array")
        return
    if len(cues) != EXPECTED_MUSIC_CUES:
        rep.warn("MUSIC_COUNT",
                 f"expected {EXPECTED_MUSIC_CUES} music cues, found {len(cues)}")

    for c in cues:
        cid = c.get("cue_id", "?")
        if _check_stale(c, cid, rep, "music_cue"):
            continue
        for f in ("start", "end"):
            if not _num(c.get(f)):
                rep.err("MUSIC_FIELD_MISSING",
                        f"music_cue {cid}: missing/non-numeric '{f}' — render.js "
                        f"will default it")
        if _num(c.get("start")) and _num(c.get("end")):
            if c["end"] <= c["start"]:
                rep.err("MUSIC_RANGE", f"music_cue {cid}: end <= start")
            if total and c["start"] > total + EPS:
                rep.err("MUSIC_PAST_END",
                        f"music_cue {cid}: start {c['start']:.2f}s is past end of audio")
        sp = (c.get("style_prompt") or "").strip()
        if not sp:
            rep.err("MUSIC_STYLE_PROMPT", f"music_cue {cid}: missing style_prompt")
        elif "instrumental" not in sp.lower():
            rep.warn("MUSIC_NOT_INSTRUMENTAL",
                     f"music_cue {cid}: style_prompt should specify 'instrumental'")
        if not _num(c.get("volume_db")):
            rep.warn("MUSIC_VOLUME", f"music_cue {cid}: no volume_db (render defaults -20)")

    # coverage: music cues should not all sit at the head of the video
    starts = [c["start"] for c in cues if _num(c.get("start"))]
    if starts and total and max(starts) < total * 0.25:
        rep.err("MUSIC_FRONT_LOADED",
                f"all {len(starts)} music cues start within the first "
                f"{max(starts):.0f}s of a {total:.0f}s video — the rest will be silent")


def validate_sfx(tl, rep, total):
    cues = tl.get("sfx_cues")
    if not isinstance(cues, list):
        rep.warn("SFX_MISSING", "timeline has no 'sfx_cues' array")
        return

    punct = 0
    for c in cues:
        cid = c.get("cue_id", "?")
        if _check_stale(c, cid, rep, "sfx_cue"):
            continue
        t = c.get("type")
        if t == "sfx" or t not in VALID_SFX_TYPES:
            rep.err("SFX_TYPE_INVALID",
                    f"sfx_cue {cid}: type '{t}' not in {sorted(VALID_SFX_TYPES)} "
                    f"(note: 'type' carries the category, not 'sfx'/'subtype')")
        if t == "punctuation":
            punct += 1
        for f in ("start", "end", "duration"):
            if not _num(c.get(f)):
                rep.err("SFX_FIELD_MISSING", f"sfx_cue {cid}: missing/non-numeric '{f}'")
        if _num(c.get("start")) and total and c["start"] > total + EPS:
            rep.err("SFX_PAST_END", f"sfx_cue {cid}: start past end of audio")
        if not (c.get("prompt") or "").strip():
            rep.err("SFX_PROMPT_MISSING",
                    f"sfx_cue {cid}: empty 'prompt' — nothing to generate from")
        if not _num(c.get("volume_db")):
            rep.warn("SFX_VOLUME", f"sfx_cue {cid}: no volume_db")

    if punct > MAX_PUNCTUATION_SFX:
        rep.warn("SFX_PUNCT_COUNT",
                 f"{punct} punctuation SFX exceeds recommended max {MAX_PUNCTUATION_SFX}")


def validate_stats(tl, rep, n_img, n_vid):
    st = tl.get("placement_stats")
    if not isinstance(st, dict):
        rep.warn("STATS_MISSING", "no placement_stats block")
        return
    scenes = tl.get("scenes") or []
    checks = [
        ("total_scenes", len(scenes)),
        ("image_scenes", n_img),
        ("video_scenes", n_vid),
        ("music_cue_count", len(tl.get("music_cues") or [])),
        ("sfx_cue_count", len(tl.get("sfx_cues") or [])),
    ]
    for key, actual in checks:
        if key in st and st[key] != actual:
            rep.warn("STATS_MISMATCH",
                     f"placement_stats.{key} says {st[key]}, actual is {actual}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--warn-only", action="store_true",
                    help="report but always exit 0 (for diagnostics, not the pipeline)")
    ap.add_argument("--json-out", help="write machine-readable result to this path")
    args = ap.parse_args()

    ep = args.episode_dir.rstrip("/")
    path = os.path.join(ep, "scripts", "media_timeline.json")

    if not os.path.exists(path):
        print(f"ERROR: {path} not found", file=sys.stderr)
        sys.exit(2)
    try:
        with open(path) as f:
            tl = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: {path} is not valid JSON — {e}", file=sys.stderr)
        sys.exit(2)

    rep = Report()
    print(f"Timeline validation: {os.path.basename(ep)}")

    res = validate_scenes(tl, rep)
    n_img, n_vid = res if res else (0, 0)

    total = tl.get("total_duration_seconds")
    if not _num(total):
        total = tl.get("total_audio_duration_seconds")
    total = total if _num(total) else None

    validate_music(tl, rep, total)
    validate_sfx(tl, rep, total)
    validate_stats(tl, rep, n_img, n_vid)

    scenes = tl.get("scenes") or []
    print(f"  Scenes: {len(scenes)} ({n_img} image / {n_vid} video)  |  "
          f"Audio: {total if total else '?'}s")
    print(f"  Music cues: {len(tl.get('music_cues') or [])}  |  "
          f"SFX cues: {len(tl.get('sfx_cues') or [])}")
    print()

    def emit(items, header, cap=6):
        """Group by code so a systemic fault reads as one finding, not 200."""
        print(header)
        grouped = {}
        for code, msg in items:
            grouped.setdefault(code, []).append(msg)
        for code, msgs in grouped.items():
            for m in msgs[:cap]:
                print(f"    [{code}] {m}")
            if len(msgs) > cap:
                print(f"    [{code}] … and {len(msgs) - cap} more with the same code")
        print()

    if rep.warnings:
        emit(rep.warnings, f"⚠️  Warnings ({len(rep.warnings)}):")

    if rep.errors:
        emit(rep.errors, f"❌ ERRORS ({len(rep.errors)}) — generation blocked:")
        print("   Timeline must be regenerated or hand-corrected before any asset")
        print("   generation spend. Nothing has been generated.")
    else:
        print("✅ Timeline valid. Safe to proceed to asset generation.")

    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump({
                "valid": rep.ok,
                "error_count": len(rep.errors),
                "warning_count": len(rep.warnings),
                "errors": [{"code": c, "message": m} for c, m in rep.errors],
                "warnings": [{"code": c, "message": m} for c, m in rep.warnings],
                "scenes": len(scenes),
                "image_scenes": n_img,
                "video_scenes": n_vid,
            }, f, indent=2)

    sys.exit(0 if (rep.ok or args.warn_only) else 1)


if __name__ == "__main__":
    main()
