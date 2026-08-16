#!/usr/bin/env python3
"""
segment.py — Ruins Untold deterministic scene segmenter (Phase 2, step 1 of 2).

Replaces the arithmetic half of the Media Placement Agent. Reads the Whisper
transcript and the voice package, and emits scene_skeleton.json: every scene
boundary, every timestamp, every J-cut offset, act spans, music cue windows, and
transition SFX anchors — all computed, none guessed.

The describe-only agent (step 2) then fills in the creative fields. It never
emits a number: it references scenes by scene_id and code materialises the
timing. That is the whole point of the split.

Why this exists (2026-08-10 architecture audit):
  The Media Placement Agent was doing 9 deterministic jobs and 2 creative ones in
  a single shot. Every recurring pipeline bug — Derinkuyu scene_009 at 27.23s
  against a 10s hard cap, coverage gaps, overlapping dissolves, front-loaded
  music — came from the deterministic 9. Measured on H-Blocks: 56 of 171
  sentence gaps exceed 10 seconds, so sentence-boundary-only segmentation
  *cannot* satisfy the cap. It needs word-boundary fallback, which is exactly the
  rule an LLM kept dropping.

Usage:
    python3 segment.py <episode_dir> [--out PATH] [--verbose]

Exit codes:
    0 — skeleton written and internally consistent
    1 — input present but segmentation failed a self-check
    2 — required input missing/unreadable
"""

import argparse
import json
import os
import sys

# ── Spec constants — must match media_placement_agent.md, render.js, validator ─
JCUT_OFFSET   = 1.5    # visual_in = audio_in + 1.5 (scene 1 is pinned to 0)
XFADE_DUR     = 0.75
MAX_SCENE     = 10.0   # hard cap, never exceeded
TARGET_MIN    = 5.0    # preferred minimum
SEMANTIC_MIN  = 4.0    # acceptable minimum at a semantic break

MUSIC_VOLUME_DB      = -20
MUSIC_FADE_IN        = 3.0
MUSIC_FADE_OUT       = 4.0
TRANSITION_VOLUME_DB = -15
TRANSITION_DUR       = 2.0
TRANSITION_LEAD      = 0.5   # fires 0.5s before the act cut

SENTENCE_ENDS = (".", "?", "!")

# Act ordering used to lay music cues onto whatever acts actually exist.
ACT_ORDER = ["cold_open", "hook", "act1", "act2", "act3", "act4", "act5",
             "conclusion", "cta"]


def r3(x):
    return round(float(x), 3)


# ── Transcript parsing ───────────────────────────────────────────────────────

def load_words(transcript_path):
    """
    Rebuild real words from whisper-cpp tokens.

    whisper-cpp emits sub-word tokens ("caliper" -> " cal" + "iper"). A leading
    space marks a word start, so tokens without one are continuations. The
    bridge's own parser strips whitespace and therefore loses this, inflating the
    word count (3808 tokens vs 3006 real words on H-Blocks). Accurate words matter
    here because act alignment is done by word position.
    """
    with open(transcript_path) as f:
        data = json.load(f)

    words = []
    for entry in data.get("transcription", []):
        for tok in entry.get("tokens", []):
            text = tok.get("text", "")
            if text.startswith("[_") and text.endswith("]"):
                continue
            if not text.strip():
                continue
            off = tok.get("offsets", {})
            start = off.get("from", 0) / 1000.0
            end = off.get("to", 0) / 1000.0
            if text.startswith(" ") or not words:
                words.append({"w": text.strip(), "start": start, "end": end})
            else:
                words[-1]["w"] += text.strip()
                words[-1]["end"] = end
    return words


# ── Segmentation ─────────────────────────────────────────────────────────────

def segment_words(words, total_duration):
    """
    Greedy maximal packing under a hard 10s cap.

    For each scene, take the LAST sentence boundary that still fits inside the
    cap — this naturally merges short sentences up toward the target instead of
    emitting a flurry of 2s scenes. If no sentence boundary fits (a sentence
    longer than the cap), fall back to the last word boundary inside the cap.

    Scenes are butted: a scene cut after word k runs until the NEXT word starts,
    so inter-word silence belongs to the scene that precedes it and there is no
    dead air between visuals. The cap is therefore measured against that boundary
    time, not against the last word's end — measuring against the word end lets
    the trailing silence push a scene over the cap after butting, which is a real
    bug this function had on first run (9 scenes over cap on H-Blocks).

    Returns a list of (start_idx, end_idx) inclusive word-index pairs.
    """
    n = len(words)
    sentence_set = {i for i, w in enumerate(words)
                    if w["w"].rstrip().endswith(SENTENCE_ENDS)}

    def boundary_time(k):
        """Where a scene cut after word k actually lands."""
        return words[k + 1]["start"] if k + 1 < n else total_duration

    spans = []
    i = 0
    while i < n:
        scene_start_t = words[i]["start"]
        cap_t = scene_start_t + MAX_SCENE

        # Widest cut index whose boundary still fits under the cap.
        j = i
        while j + 1 < n and boundary_time(j + 1) <= cap_t:
            j += 1

        # Prefer the last sentence boundary in (i..j] that clears the semantic min.
        cut = None
        for k in range(j, i - 1, -1):
            if k in sentence_set and boundary_time(k) - scene_start_t >= SEMANTIC_MIN:
                cut = k
                break

        if cut is None:
            # Long sentence: cut at the last word inside the cap.
            # max(j, i) guarantees forward progress even if one word exceeds it.
            cut = max(j, i)

        spans.append((i, cut))
        i = cut + 1

    # Fold a runt tail scene into its predecessor when that stays legal.
    if len(spans) >= 2:
        s, e = spans[-1]
        if total_duration - words[s]["start"] < SEMANTIC_MIN:
            ps, _ = spans[-2]
            if total_duration - words[ps]["start"] <= MAX_SCENE:
                spans[-2] = (ps, e)
                spans.pop()

    return spans


# ── Act alignment ────────────────────────────────────────────────────────────

def build_act_spans(voice_package, words, total_duration):
    """
    Map voice_package acts onto transcript time by cumulative word position.

    The voiceover was rendered from these segments in order, so word order is
    preserved; only the counts drift slightly (ASR vs script: 3006 vs 3058 on
    H-Blocks, ~1.7%). Proportional mapping is well within the tolerance needed to
    place a music cue.
    """
    segs = voice_package.get("segments") or []
    if not segs or not words:
        return []

    counts = []
    for s in segs:
        try:
            counts.append(max(int(s.get("word_count") or 0), 0))
        except (TypeError, ValueError):
            counts.append(len((s.get("narration_text") or "").split()))
    script_total = sum(counts) or 1
    n_words = len(words)

    def t_at(cum):
        idx = int(round(cum / script_total * n_words))
        idx = max(0, min(idx, n_words - 1))
        return words[idx]["start"]

    spans = []
    cum = 0
    for s, c in zip(segs, counts):
        start_t = t_at(cum)
        cum += c
        end_t = t_at(cum)
        spans.append({"act": s.get("act") or "unknown",
                      "segment_id": s.get("segment_id"),
                      "start": start_t, "end": end_t})

    # Collapse consecutive segments sharing an act into one span.
    merged = []
    for sp in spans:
        if merged and merged[-1]["act"] == sp["act"]:
            merged[-1]["end"] = sp["end"]
        else:
            merged.append({"act": sp["act"], "start": sp["start"], "end": sp["end"]})

    if merged:
        merged[0]["start"] = 0.0
        merged[-1]["end"] = total_duration
        for a, b in zip(merged, merged[1:]):
            b["start"] = a["end"]
    return merged


def act_at(act_spans, t):
    for sp in act_spans:
        if sp["start"] <= t < sp["end"]:
            return sp["act"]
    return act_spans[-1]["act"] if act_spans else "unknown"


# ── Music cues ───────────────────────────────────────────────────────────────

def build_music_cues(act_spans, total_duration):
    """
    Exactly 5 contiguous cues covering 0 -> total, derived from act boundaries.

    Falls back to proportional thirds/fifths when acts are missing (the CTA act
    was removed from the Script Agent in 8489767, so newer episodes have one
    fewer act than the prompt table assumes). Cues are contiguous by
    construction, which makes the validator's MUSIC_FRONT_LOADED check
    unreachable — the Derinkuyu "everything stacks in the first 60s" failure
    cannot recur from this path.
    """
    have = {sp["act"]: sp for sp in act_spans}

    def start_of(*acts):
        for a in acts:
            if a in have:
                return have[a]["start"]
        return None

    marks = [
        start_of("act1"),
        start_of("act4"),
        start_of("act5"),
        start_of("cta", "conclusion"),
    ]
    # Fill gaps with evenly spaced fallbacks, keeping strict ascending order.
    fallback = [total_duration * f for f in (0.20, 0.45, 0.70, 0.88)]
    marks = [m if m is not None else fallback[i] for i, m in enumerate(marks)]

    cleaned = []
    prev = 0.0
    for i, m in enumerate(marks):
        m = max(m, prev + 1.0)
        m = min(m, total_duration - (len(marks) - i))
        cleaned.append(m)
        prev = m

    bounds = [0.0] + cleaned + [total_duration]
    names = ["music_intro", "music_investigation", "music_revelation",
             "music_reflection", "music_outro"]
    acts = ["intro", "investigation", "revelation", "reflection", "outro"]

    cues = []
    for i, (cid, act) in enumerate(zip(names, acts)):
        s, e = bounds[i], bounds[i + 1]
        cues.append({
            "cue_id": cid,
            "act": act,
            "start": r3(s),
            "end": r3(e),
            "duration": r3(e - s),
            "volume_db": MUSIC_VOLUME_DB,
            "fade_in_seconds": MUSIC_FADE_IN,
            "fade_out_seconds": MUSIC_FADE_OUT,
            "asset_path": None,
        })
    return cues


def build_transition_sfx(act_spans, total_duration):
    """One transition cue per interior act boundary, capped to keep it sparse."""
    cues = []
    boundaries = [sp["start"] for sp in act_spans[1:]]
    for idx, b in enumerate(boundaries, start=1):
        start = max(0.0, b - TRANSITION_LEAD)
        end = min(total_duration, start + TRANSITION_DUR)
        if end - start < 0.5:
            continue
        cues.append({
            "cue_id": f"sfx_trans_{idx:03d}",
            "type": "transition",
            "start": r3(start),
            "end": r3(end),
            "duration": r3(end - start),
            "volume_db": TRANSITION_VOLUME_DB,
            "asset_path": None,
        })
    return cues


# ── Self-check ───────────────────────────────────────────────────────────────

def self_check(scenes, total_duration):
    """Assert in code what the prompt used to merely request."""
    problems = []
    prev_out = None
    for i, s in enumerate(scenes):
        dur = s["audio_out"] - s["audio_in"]
        if dur > MAX_SCENE + 0.02:
            problems.append(f"{s['scene_id']}: {dur:.2f}s exceeds {MAX_SCENE}s cap")
        if dur <= 0:
            problems.append(f"{s['scene_id']}: non-positive duration")
        if i == 0:
            if abs(s["visual_in"]) > 0.001:
                problems.append(f"{s['scene_id']}: first visual_in must be 0")
        elif abs(s["visual_in"] - (s["audio_in"] + JCUT_OFFSET)) > 0.02:
            problems.append(f"{s['scene_id']}: visual_in J-cut mismatch")
        if abs(s["visual_out"] - (s["audio_out"] + JCUT_OFFSET)) > 0.02:
            problems.append(f"{s['scene_id']}: visual_out J-cut mismatch")
        if prev_out is not None and s["audio_in"] < prev_out - 0.02:
            problems.append(f"{s['scene_id']}: overlaps previous scene")
        prev_out = s["audio_out"]
    if scenes and abs(scenes[-1]["audio_out"] - total_duration) > 1.0:
        problems.append(
            f"coverage gap: last scene ends {scenes[-1]['audio_out']:.2f}s, "
            f"audio is {total_duration:.2f}s")
    return problems


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    ep = args.episode_dir.rstrip("/")
    transcript_path = os.path.join(ep, "scripts", "transcript.json")
    vp_path = os.path.join(ep, "audio", "voice_package.json")
    out_path = args.out or os.path.join(ep, "scripts", "scene_skeleton.json")

    for p in (transcript_path, vp_path):
        if not os.path.exists(p):
            print(f"ERROR: required input missing: {p}", file=sys.stderr)
            sys.exit(2)

    try:
        words = load_words(transcript_path)
        with open(vp_path) as f:
            vp = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: could not read inputs — {e}", file=sys.stderr)
        sys.exit(2)

    if not words:
        print("ERROR: transcript produced zero words", file=sys.stderr)
        sys.exit(2)

    total_duration = r3(words[-1]["end"])
    act_spans = build_act_spans(vp, words, total_duration)
    spans = segment_words(words, total_duration)

    n_words = len(words)

    def boundary_time(k):
        return words[k + 1]["start"] if k + 1 < n_words else total_duration

    scenes = []
    for idx, (a, b) in enumerate(spans, start=1):
        audio_in = 0.0 if idx == 1 else r3(words[a]["start"])
        audio_out = r3(boundary_time(b))
        visual_in = 0.0 if idx == 1 else r3(audio_in + JCUT_OFFSET)
        visual_out = r3(audio_out + JCUT_OFFSET)
        narration = " ".join(w["w"] for w in words[a:b + 1]).strip()
        scenes.append({
            "scene_id": f"scene_{idx:03d}",
            "sequence": idx,
            "act": act_at(act_spans, audio_in),
            "audio_in": audio_in,
            "audio_out": audio_out,
            "visual_in": visual_in,
            "visual_out": visual_out,
            "duration_seconds": r3(audio_out - audio_in),
            "narration_text": narration,
            "cross_dissolve_duration": XFADE_DUR,
        })

    # Scenes are already butted by construction (audio_out == next audio_in via
    # boundary_time). Pin the tail to the authoritative duration so coverage is
    # exact rather than merely close.
    if scenes:
        scenes[-1]["audio_out"] = total_duration
        scenes[-1]["visual_out"] = r3(total_duration + JCUT_OFFSET)
        scenes[-1]["duration_seconds"] = r3(total_duration - scenes[-1]["audio_in"])

    problems = self_check(scenes, total_duration)

    skeleton = {
        "topic": vp.get("topic"),
        "audio_file": os.path.join(ep, "audio", "voiceover_final.mp3"),
        "total_duration_seconds": total_duration,
        "generated_by": "segment.py (deterministic)",
        "default_transition": {"type": "cross_dissolve",
                               "duration": XFADE_DUR,
                               "jcut_offset": JCUT_OFFSET},
        "acts": [{"act": a["act"], "start": r3(a["start"]), "end": r3(a["end"])}
                 for a in act_spans],
        "scenes": scenes,
        "music_cues": build_music_cues(act_spans, total_duration),
        "sfx_cues": build_transition_sfx(act_spans, total_duration),
        "placement_stats": {
            "total_scenes": len(scenes),
            "avg_scene_duration_seconds": r3(
                sum(s["duration_seconds"] for s in scenes) / len(scenes)) if scenes else 0,
            "words": len(words),
        },
    }

    durs = [s["duration_seconds"] for s in scenes]
    print(f"Segmented: {os.path.basename(ep)}")
    print(f"  Words: {len(words)}  |  Audio: {total_duration}s  |  Acts: {len(act_spans)}")
    print(f"  Scenes: {len(scenes)}  |  dur min/avg/max: "
          f"{min(durs):.2f}/{sum(durs)/len(durs):.2f}/{max(durs):.2f}s")
    print(f"  Over cap: {sum(1 for d in durs if d > MAX_SCENE + 0.02)}  |  "
          f"Under {SEMANTIC_MIN}s: {sum(1 for d in durs if d < SEMANTIC_MIN - 0.02)}")
    print(f"  Music cues: {len(skeleton['music_cues'])}  |  "
          f"Transition SFX: {len(skeleton['sfx_cues'])}")

    if args.verbose:
        for a in skeleton["acts"]:
            print(f"    act {a['act']:<12} {a['start']:>8.2f} → {a['end']:>8.2f}")

    if problems:
        print()
        print(f"❌ Self-check FAILED ({len(problems)}):")
        for p in problems[:15]:
            print(f"    {p}")
        sys.exit(1)

    with open(out_path, "w") as f:
        json.dump(skeleton, f, indent=2)
    print(f"  ✅ Self-check passed → {out_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
