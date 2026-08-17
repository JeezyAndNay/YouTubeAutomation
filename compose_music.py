#!/usr/bin/env python3
"""
compose_music.py — Ruins Untold Phase 2, music composition (new stage, 2026-08-12).

Single-purpose LLM call: era/culture detection + 5 Suno-ready music prompts. Everything
else about music (timing, cue windows, act boundaries) is already computed deterministically
by segment.py in scene_skeleton.json — this only fills the creative fields.

Why this exists: the era/culture accent palette in music_sfx.md died when Phase 2's music
generation moved from Kie.ai/Suno to direct ElevenLabs sound-generation (450-char prompt
cap; the palette needs 80-150 word prompts). merge_timeline.py's fallback templates are
generic and topic-blind. Era selection is a genuine judgment call — pattern-matching a
topic against a reference table, or reasoning about an unlisted one — that a script cannot
do reliably for arbitrary future topics, so it stays an LLM call. But it is now scoped to
exactly what needs judgment (5 short prompts, once per episode) rather than resurrecting
the old music_sfx.md's full per-scene SFX placement job, which the describe agent already
owns in v3.

If this call fails or produces malformed output, it writes nothing — merge_timeline.py
falls back to its generic MUSIC_TEMPLATES, same as before this script existed. No episode
is blocked by this stage.

Usage:
    python3 compose_music.py <episode_dir> [--model MODEL]

Exit codes:
    0 — music_composition.json written (or already existed and was left alone)
    1 — call succeeded but output failed validation; nothing written
    2 — required input missing, or the bridge call itself failed
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error

BRIDGE_URL = "http://localhost:3333/generate"
PROMPT_PATH = "/Users/jneal/n8n_projects/ruins_untold_system_prompts/music_compose_agent.md"
EXPECTED_CUES = {"music_intro", "music_investigation", "music_revelation",
                  "music_reflection", "music_outro"}
REQUIRED_CLOSE = "Instrumental only. No lyrics. No vocals."


def call_bridge(system, prompt, model, max_tokens=4096):
    body = json.dumps({
        "system": system, "prompt": prompt, "model": model,
        "max_tokens": max_tokens, "effort": "low",
    }).encode()
    req = urllib.request.Request(BRIDGE_URL, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.loads(r.read())


def extract_json(raw):
    raw = raw.strip()
    if raw.startswith("__disk__:"):
        raw = open(raw[9:]).read().strip()
    m = re.search(r"```(?:json)?\n?([\s\S]*?)```", raw)
    if m:
        raw = m.group(1).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        if s < 0 or e < 0:
            raise
        return json.loads(raw[s:e + 1])


def validate(parsed):
    """Returns a list of problems; empty list means the output is usable."""
    problems = []
    accent = parsed.get("era_culture_accent")
    if not isinstance(accent, str) or not accent.strip():
        problems.append("era_culture_accent missing or empty")

    cues = parsed.get("cues")
    if not isinstance(cues, dict):
        problems.append("cues is missing or not an object")
        return problems

    got = set(cues.keys())
    if got != EXPECTED_CUES:
        problems.append(f"cue keys mismatch: expected {sorted(EXPECTED_CUES)}, "
                         f"got {sorted(got)}")

    titles = []
    for cue_id in EXPECTED_CUES & got:
        c = cues[cue_id]
        if not isinstance(c, dict):
            problems.append(f"{cue_id}: not an object")
            continue
        sp = (c.get("suno_prompt") or "").strip()
        if not sp:
            problems.append(f"{cue_id}: empty suno_prompt")
        else:
            words = len(sp.split())
            if not (60 <= words <= 200):
                problems.append(f"{cue_id}: suno_prompt is {words} words, expected ~80-150")
            if not sp.endswith(REQUIRED_CLOSE):
                problems.append(f"{cue_id}: suno_prompt does not end with required close line")
        title = (c.get("suno_title") or "").strip()
        if not title:
            problems.append(f"{cue_id}: empty suno_title")
        titles.append(title)
        if not (c.get("suno_tags") or "").strip():
            problems.append(f"{cue_id}: empty suno_tags")

    non_empty_titles = [t for t in titles if t]
    if len(non_empty_titles) != len(set(non_empty_titles)):
        problems.append("suno_title values are not all unique")

    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--model", default="claude-sonnet-4-6")
    args = ap.parse_args()

    ep = args.episode_dir.rstrip("/")
    skel_path = os.path.join(ep, "scripts", "scene_skeleton.json")
    out_path = os.path.join(ep, "scripts", "music_composition.json")

    if os.path.exists(out_path):
        print(f"music_composition.json already exists — leaving it alone: {out_path}")
        print("  (delete it first if you want a fresh composition)")
        sys.exit(0)

    if not os.path.exists(skel_path):
        print(f"ERROR: {skel_path} not found — run segment.py first", file=sys.stderr)
        sys.exit(2)
    if not os.path.exists(PROMPT_PATH):
        print(f"ERROR: {PROMPT_PATH} not found", file=sys.stderr)
        sys.exit(2)

    skel = json.load(open(skel_path))
    system = open(PROMPT_PATH).read()

    narration = " ".join(s.get("narration_text", "") for s in skel.get("scenes", []))
    windows = [{"cue_id": c["cue_id"], "act": c["act"], "start": c["start"],
                "end": c["end"], "duration": c["duration"]}
               for c in skel.get("music_cues", [])]

    if len(windows) != 5:
        print(f"ERROR: scene_skeleton.json has {len(windows)} music_cues, expected 5",
              file=sys.stderr)
        sys.exit(2)

    input_obj = {
        "topic": skel.get("topic"),
        "total_duration_seconds": skel.get("total_duration_seconds"),
        "music_cue_windows": windows,
        "narration": narration,
    }
    prompt = "Your input:\n\n" + json.dumps(input_obj, indent=2)

    print(f"Composing music: {os.path.basename(ep)}")
    print(f"  topic: {skel.get('topic')}")
    print(f"  narration: {len(narration.split())} words")

    try:
        resp = call_bridge(system, prompt, args.model)
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: bridge call failed — {e}", file=sys.stderr)
        print("       Is the bridge running? cd /Users/jneal/n8n_projects/ClaudeBridge "
              "&& python3 claude-bridge.py", file=sys.stderr)
        sys.exit(2)

    if resp.get("exitCode"):
        print(f"ERROR: bridge returned an error — {resp.get('error', '')[:300]}",
              file=sys.stderr)
        sys.exit(2)

    try:
        parsed = extract_json(resp.get("output", ""))
    except json.JSONDecodeError as e:
        print(f"ERROR: could not parse agent output as JSON — {e}", file=sys.stderr)
        sys.exit(1)

    problems = validate(parsed)
    if problems:
        print(f"❌ Output failed validation ({len(problems)}) — nothing written:")
        for p in problems:
            print(f"    {p}")
        print("  merge_timeline.py will fall back to generic templates for this episode.")
        sys.exit(1)

    with open(out_path, "w") as f:
        json.dump(parsed, f, indent=2)

    print(f"  era_culture_accent: {parsed['era_culture_accent']}")
    for cue_id in ("music_intro", "music_investigation", "music_revelation",
                    "music_reflection", "music_outro"):
        c = parsed["cues"][cue_id]
        print(f"    {cue_id:20s} {len(c['suno_prompt'].split()):3d} words  "
              f"{c['suno_title']}")
    print(f"  ✅ → {out_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
