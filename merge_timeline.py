#!/usr/bin/env python3
"""
merge_timeline.py — Ruins Untold Phase 2, step 2 of 2.

Combines the deterministic scene_skeleton.json (from segment.py) with the
describe-only agent's creative output, and emits media_timeline.json in the
current schema.

Division of labour — the whole point of the 2026-08-10 split:

  segment.py   scene boundaries, all timing, J-cuts, coverage, act spans,
               music cue windows, transition SFX anchors
  agent        visual_type, prompt_seed, real photo flags, ambient location
               labels, SFX prompt text  — and no numbers at all
  merge (here) ratio enforcement, materialising ambient/punctuation cues from
               scene_id references into real timestamps, music style prompts

The agent references scenes by scene_id; every timestamp in the output is
computed here from the skeleton. An agent hallucinating a number cannot corrupt
the timeline because no number it writes is ever read.

Usage:
    python3 merge_timeline.py <episode_dir> [--chunks GLOB] [--out PATH]

Exit codes:
    0 — media_timeline.json written
    1 — merge failed (missing scenes, unusable agent output)
    2 — required input missing
"""

import argparse
import glob
import json
import os
import sys

MAX_IMG_VID_RATIO = 3.0
MAX_REAL_PHOTO_RATIO = 0.25   # ceiling on Wikimedia-sourced scenes per episode
PUNCTUATION_CAP = 6

AMBIENT_VOLUME_DB = -28
PUNCT_VOLUME_DB = -12
PUNCT_DURATION = 2.0

# Music style prompts are fixed per act by the spec table in the original
# Media Placement Agent prompt — they never varied per episode in practice, so
# templating them removes an LLM call with no loss. "instrumental" is guaranteed
# present, which is a hard Suno requirement.
MUSIC_TEMPLATES = {
    "music_intro": (
        "dark_mysterious",
        "Mysterious atmospheric slow-building underscore, ambient drone with sparse piano "
        "and strings, minor key, no percussion, instrumental",
    ),
    "music_investigation": (
        "tense_investigative",
        "Tense investigative documentary underscore, low strings with a subtle pulse, "
        "building unease, restrained, instrumental",
    ),
    "music_revelation": (
        "dramatic_revelatory",
        "Dramatic unsettling revelatory cinematic swell, dissonance resolving to an open "
        "chord, wide and tense, instrumental",
    ),
    "music_reflection": (
        "expansive_haunting",
        "Expansive haunting philosophical underscore, sparse open ambient pads with space "
        "between notes, unhurried, instrumental",
    ),
    "music_outro": (
        "unresolved_closing",
        "Closing mysterious unresolved underscore, returns to the opening ambient texture, "
        "ends without full cadence, instrumental",
    ),
}

TRANSITION_PROMPTS = [
    "Deep whoosh sweep moving from an enclosed stone space into open air, dark harmonic "
    "wash, rapid onset, two second natural reverb tail",
    "Low subterranean rumble rising from underground toward open sky, dark tonal resonance "
    "expanding outward, slow onset, stone cave to open plateau reverb shift",
]


def r3(x):
    return round(float(x), 3)


def load_chunks(episode_dir, pattern):
    paths = sorted(glob.glob(os.path.join(episode_dir, pattern)))
    if not paths:
        return None, []
    scenes, ambient_prompts = {}, {}
    for p in paths:
        try:
            with open(p) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"WARNING: skipping unreadable chunk {os.path.basename(p)} — {e}",
                  file=sys.stderr)
            continue
        for s in data.get("scenes", []):
            sid = s.get("scene_id")
            if sid:
                scenes[sid] = s
        ambient_prompts.update(data.get("ambient_prompts") or {})
    return scenes, ambient_prompts


def enforce_ratio(scenes, warnings):
    """
    Upgrade image scenes to video until image:video <= 3:1.

    Deterministic, and never downgrades video (per spec). Longest image scenes go
    first — 8-10s of a static frame is where viewer fatigue actually shows up.
    """
    imgs = [s for s in scenes if s["visual_type"] == "image"]
    vids = [s for s in scenes if s["visual_type"] == "video"]
    if not imgs:
        return
    if not vids:
        # Degenerate agent output; promote the longest scenes to get motion in.
        target = max(1, len(scenes) // 4)
        for s in sorted(imgs, key=lambda x: -x["duration_seconds"])[:target]:
            s["visual_type"] = "video"
        warnings.append("agent returned zero video scenes; promoted longest images")
        return

    n_img, n_vid = len(imgs), len(vids)
    upgrades = 0
    order = sorted(imgs, key=lambda x: -x["duration_seconds"])
    while n_img / n_vid > MAX_IMG_VID_RATIO and upgrades < len(order):
        order[upgrades]["visual_type"] = "video"
        upgrades += 1
        n_img -= 1
        n_vid += 1
    if upgrades:
        warnings.append(
            f"ratio enforcement upgraded {upgrades} image scene(s) to video "
            f"(now {n_img}:{n_vid})")


def cap_real_photos(scenes, warnings, max_ratio=MAX_REAL_PHOTO_RATIO):
    """
    Limit how much of the episode is sourced from Wikimedia rather than generated.

    Observed on the first live run: the agent flagged 67 of 151 Derinkuyu scenes
    (44%) as real_photo_preferred. The spec says flag true "only when confident a
    specific, usable photo exists", so that is over-eager, and it matters because
    Stock Sourcing takes the top search result — a weak or off-subject photo
    lands silently, since "found a photo" counts as success. At 44% density it
    also reads as stylistically inconsistent against cinematic AI footage.

    Keeps the most defensible flags and clears the rest (the scenes still have a
    prompt_seed, so they simply generate instead).

    Ranking favours:
      - proper nouns in the query (a named site or artifact is what Wikimedia is
        actually good at, vs. a generic "ancient door")
      - more specific multi-word queries
      - image scenes over video scenes (a still on a video scene is a downgrade)

    Then enforces spacing so surviving photos are spread through the episode
    rather than clustered into one stretch that looks like a slideshow.
    """
    flagged = [s for s in scenes if s.get("real_photo_preferred")]
    if not flagged:
        return
    limit = int(len(scenes) * max_ratio)
    if len(flagged) <= limit:
        return

    def score(s):
        q = (s.get("wikimedia_search_query") or "").strip()
        toks = q.split()
        propers = sum(1 for w in toks if w[:1].isupper())
        return (2.0 * propers
                + 0.5 * min(len(toks), 5)
                + (1.0 if s["visual_type"] == "image" else 0.0))

    idx = {s["scene_id"]: i for i, s in enumerate(scenes)}
    keep, kept_idx = [], []
    for s in sorted(flagged, key=score, reverse=True):
        if len(keep) >= limit:
            break
        i = idx[s["scene_id"]]
        if any(abs(i - j) < 2 for j in kept_idx):   # no two adjacent scenes
            continue
        keep.append(s["scene_id"])
        kept_idx.append(i)

    keep = set(keep)
    cleared = 0
    for s in flagged:
        if s["scene_id"] not in keep:
            s["real_photo_preferred"] = False
            s["wikimedia_search_query"] = None
            cleared += 1
    if cleared:
        pct = len(keep) / len(scenes) * 100
        warnings.append(
            f"real-photo cap: kept {len(keep)} of {len(flagged)} flagged scenes "
            f"({pct:.0f}% of episode), cleared {cleared} to AI generation")


def smooth_ambient(scenes, warnings, min_run=3, max_cues=14):
    """
    Consolidate ambient labels into continuous beds.

    Observed on the first real Haiku run (Derinkuyu chunk 0): the agent labels by
    narrative subject rather than acoustic space — underground_chamber,
    underground_city, underground_tunnel, underground_dwelling_ancient and
    underground_phrygian are one stone-underground space to a listener — and
    sprinkles nulls between them. That produced 17 runs across 30 scenes, which
    would restart the ambient bed every few seconds.

    Prose asked for continuity and did not get it, so this enforces it:
      1. bridge short null gaps flanked by the same label
      2. absorb runs shorter than min_run into a neighbour
      3. collapse the smallest remaining runs until at most max_cues survive

    Mutates scenes[]['_ambient'] in place.
    """
    labels = [s.get("_ambient") for s in scenes]
    n = len(labels)
    if n == 0:
        return

    def runs_of(seq):
        out = []
        for i, lab in enumerate(seq):
            if out and out[-1][0] == lab:
                out[-1][2] = i
            else:
                out.append([lab, i, i])
        return out

    # 1. Bridge null gaps of <= 2 scenes between identical labels.
    for r_prev, r_gap, r_next in zip(runs_of(labels), runs_of(labels)[1:], runs_of(labels)[2:]):
        if (r_gap[0] is None and r_prev[0] is not None
                and r_prev[0] == r_next[0]
                and (r_gap[2] - r_gap[1] + 1) <= 2):
            for i in range(r_gap[1], r_gap[2] + 1):
                labels[i] = r_prev[0]

    # 2 & 3. Absorb short runs, then cap the total number of beds.
    def collapse(threshold_only=None):
        changed = True
        while changed:
            changed = False
            rs = [r for r in runs_of(labels)]
            for idx, (lab, a, b) in enumerate(rs):
                if lab is None:
                    continue
                length = b - a + 1
                if threshold_only is not None and length >= threshold_only:
                    continue
                prev_lab = rs[idx - 1][0] if idx > 0 else None
                next_lab = rs[idx + 1][0] if idx + 1 < len(rs) else None
                target = prev_lab if prev_lab is not None else next_lab
                if target is None:
                    continue
                for i in range(a, b + 1):
                    labels[i] = target
                changed = True
                break

    # Hold the bed through abstract (null) scenes instead of dropping out and
    # restarting a few seconds later — a gap reads as a mistake, a held bed does
    # not. This also gives runs that were flanked by nulls on both sides a
    # neighbour to be absorbed into on the next collapse pass.
    last = None
    for i, lab in enumerate(labels):
        if lab is not None:
            last = lab
        elif last is not None:
            labels[i] = last
    if labels and labels[0] is None:
        first = next((l for l in labels if l is not None), None)
        for i, lab in enumerate(labels):
            if lab is None:
                labels[i] = first
            else:
                break

    collapse(threshold_only=min_run)
    guard = 0
    while len([r for r in runs_of(labels) if r[0] is not None]) > max_cues and guard < n:
        rs = [r for r in runs_of(labels) if r[0] is not None]
        smallest = min(rs, key=lambda r: r[2] - r[1])
        all_runs = runs_of(labels)
        pos = next(i for i, r in enumerate(all_runs)
                   if r[1] == smallest[1] and r[2] == smallest[2])
        prev_lab = all_runs[pos - 1][0] if pos > 0 else None
        next_lab = all_runs[pos + 1][0] if pos + 1 < len(all_runs) else None
        target = prev_lab if prev_lab is not None else next_lab
        if target is None:
            break
        for i in range(smallest[1], smallest[2] + 1):
            labels[i] = target
        guard += 1

    before = len([r for r in runs_of([s.get("_ambient") for s in scenes]) if r[0] is not None])
    for s, lab in zip(scenes, labels):
        s["_ambient"] = lab
    after = len([r for r in runs_of(labels) if r[0] is not None])
    if before != after:
        warnings.append(
            f"ambient smoothing consolidated {before} label runs into {after} continuous beds")


def build_ambient_cues(scenes, ambient_prompts, warnings):
    """Group consecutive scenes sharing an ambient_location into one cue."""
    cues, run = [], []

    def flush(run):
        if not run:
            return
        label = run[0]["_ambient"]
        prompt = (ambient_prompts.get(label) or "").strip()
        if not prompt:
            warnings.append(f"no ambient prompt supplied for label '{label}' — cue dropped")
            return
        start, end = run[0]["audio_in"], run[-1]["audio_out"]
        cues.append({
            "cue_id": f"sfx_amb_{len(cues) + 1:03d}",
            "type": "ambient",
            "start": r3(start),
            "end": r3(end),
            "duration": r3(end - start),
            "description": f"Ambient bed — {label.replace('_', ' ')}",
            "prompt": prompt,
            "volume_db": AMBIENT_VOLUME_DB,
            "asset_path": None,
        })

    for s in scenes:
        label = s.get("_ambient")
        if not label:
            flush(run)
            run = []
            continue
        if run and run[-1]["_ambient"] == label:
            run.append(s)
        else:
            flush(run)
            run = [s]
    flush(run)
    return cues


def build_punctuation_cues(scenes, warnings):
    picked = [s for s in scenes if s.get("_punct")]
    if len(picked) > PUNCTUATION_CAP:
        warnings.append(
            f"agent proposed {len(picked)} punctuation SFX; capped at {PUNCTUATION_CAP}")
        picked = picked[:PUNCTUATION_CAP]
    cues = []
    for i, s in enumerate(picked, start=1):
        p = s["_punct"]
        prompt = (p.get("prompt") or "").strip()
        if not prompt:
            warnings.append(f"{s['scene_id']}: punctuation SFX had no prompt — dropped")
            continue
        start = s["audio_in"]
        end = min(start + PUNCT_DURATION, s["audio_out"])
        if end - start < 0.5:
            end = start + PUNCT_DURATION
        cues.append({
            "cue_id": f"sfx_punc_{i:03d}",
            "type": "punctuation",
            "start": r3(start),
            "end": r3(end),
            "duration": r3(end - start),
            "description": (p.get("description") or "Punctuation hit").strip(),
            "prompt": prompt,
            "volume_db": PUNCT_VOLUME_DB,
            "asset_path": None,
        })
    return cues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--chunks", default="scripts/describe_chunk_*.json")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    ep = args.episode_dir.rstrip("/")
    skel_path = os.path.join(ep, "scripts", "scene_skeleton.json")
    out_path = args.out or os.path.join(ep, "scripts", "media_timeline.json")

    if not os.path.exists(skel_path):
        print(f"ERROR: {skel_path} not found — run segment.py first", file=sys.stderr)
        sys.exit(2)

    with open(skel_path) as f:
        skel = json.load(f)

    described, ambient_prompts = load_chunks(ep, args.chunks)
    if described is None:
        print(f"ERROR: no describe chunks matched {args.chunks}", file=sys.stderr)
        sys.exit(2)

    warnings = []
    scenes, missing = [], []

    for s in skel["scenes"]:
        sid = s["scene_id"]
        d = described.get(sid)
        if not d:
            missing.append(sid)
            d = {}

        vt = d.get("visual_type")
        if vt not in ("image", "video"):
            vt = "image"
        # Short scenes hold better as stills than as truncated clips.
        if s["duration_seconds"] < 5.0:
            vt = "image"

        scene = {
            "scene_id": sid,
            "sequence": s["sequence"],
            "act": s.get("act"),
            "audio_in": s["audio_in"],
            "audio_out": s["audio_out"],
            "visual_in": s["visual_in"],
            "visual_out": s["visual_out"],
            "duration_seconds": s["duration_seconds"],
            "narration_text": s["narration_text"],
            "visual_type": vt,
            "prompt_seed": (d.get("prompt_seed") or "").strip(),
            "real_photo_preferred": bool(d.get("real_photo_preferred")),
            "wikimedia_search_query": d.get("wikimedia_search_query") or None,
            "cross_dissolve_duration": s.get("cross_dissolve_duration", 0.75),
            "asset_path": None,
            "_ambient": d.get("ambient_location") or None,
            "_punct": d.get("sfx_punctuation") or None,
        }
        if not scene["prompt_seed"]:
            warnings.append(f"{sid}: agent returned no prompt_seed")
        if scene["real_photo_preferred"] and not scene["wikimedia_search_query"]:
            scene["real_photo_preferred"] = False
            warnings.append(f"{sid}: real_photo_preferred without query — cleared")
        scenes.append(scene)

    if missing:
        print(f"ERROR: agent output missing {len(missing)} scene(s), e.g. {missing[:5]}",
              file=sys.stderr)
        print("       Re-run the describe agent for the affected chunk(s).",
              file=sys.stderr)
        sys.exit(1)

    enforce_ratio(scenes, warnings)

    cap_real_photos(scenes, warnings)
    smooth_ambient(scenes, warnings)
    ambient = build_ambient_cues(scenes, ambient_prompts, warnings)
    punct = build_punctuation_cues(scenes, warnings)

    transitions = []
    for i, c in enumerate(skel.get("sfx_cues") or []):
        c = dict(c)
        c["description"] = "Act transition sweep"
        c["prompt"] = TRANSITION_PROMPTS[i % len(TRANSITION_PROMPTS)]
        transitions.append(c)

    music = []
    for c in skel.get("music_cues") or []:
        c = dict(c)
        mood, style = MUSIC_TEMPLATES.get(
            c["cue_id"], ("atmospheric", "Atmospheric cinematic underscore, instrumental"))
        c["mood"] = mood
        c["style_prompt"] = style
        music.append(c)

    for s in scenes:
        s.pop("_ambient", None)
        s.pop("_punct", None)

    sfx = sorted(ambient + punct + transitions, key=lambda c: c["start"])
    n_img = sum(1 for s in scenes if s["visual_type"] == "image")
    n_vid = len(scenes) - n_img

    timeline = {
        "topic": skel.get("topic"),
        "audio_file": skel.get("audio_file"),
        "total_duration_seconds": skel["total_duration_seconds"],
        "generated_by": "segment.py + media_describe_agent + merge_timeline.py",
        "default_transition": skel.get("default_transition"),
        "scenes": scenes,
        "music_cues": music,
        "sfx_cues": sfx,
        "placement_stats": {
            "total_scenes": len(scenes),
            "image_scenes": n_img,
            "video_scenes": n_vid,
            "avg_scene_duration_seconds": r3(
                sum(s["duration_seconds"] for s in scenes) / len(scenes)) if scenes else 0,
            "music_cue_count": len(music),
            "sfx_cue_count": len(sfx),
            "ambient_sfx_count": len(ambient),
            "punctuation_sfx_count": len(punct),
            "transition_sfx_count": len(transitions),
            "warnings": warnings,
        },
    }

    with open(out_path, "w") as f:
        json.dump(timeline, f, indent=2)

    print(f"Merged: {os.path.basename(ep)}")
    print(f"  Scenes: {len(scenes)} ({n_img} image / {n_vid} video, "
          f"ratio {n_img / n_vid:.2f}:1)" if n_vid else f"  Scenes: {len(scenes)}")
    print(f"  Music: {len(music)}  |  SFX: {len(sfx)} "
          f"({len(ambient)} ambient, {len(punct)} punctuation, "
          f"{len(transitions)} transition)")
    if warnings:
        print(f"  Warnings ({len(warnings)}):")
        for w in warnings[:8]:
            print(f"    - {w}")
    print(f"  → {out_path}")
    print("  Run validate_media_timeline.py next (the Phase 2 gate does this).")
    sys.exit(0)


if __name__ == "__main__":
    main()
