#!/usr/bin/env python3
"""
clip_extract.py — Ruins Untold Shorts/TikTok/Reels clip pipeline (v1, 2026-08-18).

Standalone script, same maturity path as compose_music.py: prove it out manually before
any n8n wiring. Generate-only — no auto-posting. You upload the output clips by hand.

Why this exists: diagnosed via YouTube Analytics API that this channel has never once had
real external discovery. Every view across 11 episodes came from YouTube's own internal
subscriber->related-video test loop, and every test got cut after 1-2 weeks (0/262 views
from YT_SEARCH on the two biggest spikes). Short vertical clips posted to Shorts/TikTok/
Reels around publish day are meant to inject the kind of outside traffic burst that loop
has never had. See (C) YouTube Performance Tracking.md, 2026-08-18 entry.

Pipeline:
  1. Read media_timeline.json's scene list (scene_id, act, narration_text, audio timing).
     Timing is NEVER sent to the LLM -- same segment.py/agent separation used everywhere
     else in this codebase. The agent picks scene_id ranges; this script resolves exact
     timestamps deterministically from media_timeline.json.
  2. Call the Clip Selector Agent (via claude-bridge /generate) to pick 2-3 scene ranges.
  3. For each selected range: extract that time range from renders/final_video.mp4,
     reformat 16:9 -> 9:16 (blur-pad, not crop -- nothing gets cut out of frame), burn
     word-grouped captions built from transcript.json's word-level timing.
  4. Write renders/shorts/clip_NN.mp4 + renders/shorts/clips_metadata.json (hook_caption
     etc., ready to paste when you upload manually).

The actual ffmpeg work runs inside the n8n Docker container (`docker exec n8n-n8n-1
ffmpeg`), not on the host -- the host's Homebrew ffmpeg build has no libass/libfreetype
(confirmed 2026-08-18), so it can't burn text at all. The container's static-ffmpeg build
already has both (it's what render.js uses for the exact same reason). Both share the same
n8n_projects volume mount at an identical path, so no path translation is needed.

Usage:
    python3 clip_extract.py <episode_dir> [--model MODEL]

Exit codes:
    0 — at least one clip written successfully
    1 — agent output failed validation or all clips failed extraction
    2 — required input missing, or the bridge call itself failed
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

BRIDGE_URL = "http://localhost:3333/generate"
PROMPT_PATH = "/Users/jneal/n8n_projects/ruins_untold_system_prompts/clip_selector_agent.md"
CONTAINER = "n8n-n8n-1"
CLIP_W, CLIP_H = 1080, 1920
MIN_CLIP_S, MAX_CLIP_S = 6, 90  # sanity bounds; agent targets 15-45s per the prompt

# render.js applies a global `adelay=1500ms` (its NARRATION_PAUSE_SECONDS) to the entire
# narration audio track when assembling final_video.mp4 -- a one-time, constant shift over
# the whole episode, not per-scene. media_timeline.json's audio_in/audio_out and
# transcript.json's word offsets are both derived from the raw, unshifted voiceover file, so
# every one of those timestamps sits this many seconds EARLIER than where that same
# narration actually plays in final_video.mp4. Cutting straight from the raw timestamps (as
# v1 did) chops the tail off every clip's narration and throws captions out of sync by
# exactly this amount -- confirmed against real output, not theoretical. Must match
# render.js's NARRATION_PAUSE_SECONDS exactly; keep in sync if that ever changes.
FINAL_VIDEO_AUDIO_OFFSET_S = 1.5
# Small trailing pad so the last word's natural decay/breath isn't guillotined at the exact
# Whisper word-boundary timestamp.
END_PAD_S = 0.4


def call_bridge(system, prompt, model, max_tokens=2048):
    body = json.dumps({
        "system": system, "prompt": prompt, "model": model,
        "max_tokens": max_tokens, "effort": "low",
    }).encode()
    req = urllib.request.Request(BRIDGE_URL, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
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


def ass_time(seconds):
    """ASS subtitle timestamp: H:MM:SS.CC"""
    cs = round(seconds * 100)
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def build_caption_words(transcript, start_ms, end_ms):
    """Flatten transcript.json's whisper.cpp-style tokens into real words within
    [start_ms, end_ms), dropping special tokens like [_BEG_] / [_TT_nnn]."""
    words = []
    for seg in transcript.get("transcription", []):
        for tok in seg.get("tokens", []):
            off = tok.get("offsets", {})
            f, t = off.get("from"), off.get("to")
            if f is None or t is None:
                continue
            if f < start_ms or f >= end_ms:
                continue
            text = tok.get("text", "")
            if re.match(r"^\s*\[_[A-Z]+_?\d*\]\s*$", text):
                continue
            if not text.strip():
                continue
            words.append((f, t, text))
    words.sort(key=lambda w: w[0])
    return words


def build_ass_file(words, start_ms, path, group_size=3):
    """Group words into ~group_size-word caption chunks, timed relative to clip start."""
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {CLIP_W}
PlayResY: {CLIP_H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,72,&H00FFFFFF,&H00000000,&H00000000,1,0,1,4,0,2,80,80,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for i in range(0, len(words), group_size):
        chunk = words[i:i + group_size]
        chunk_start = (chunk[0][0] - start_ms) / 1000.0
        chunk_end = (chunk[-1][1] - start_ms) / 1000.0
        if chunk_end <= chunk_start:
            chunk_end = chunk_start + 0.3
        text = "".join(w[2] for w in chunk).strip().upper()
        text = text.replace("\n", " ")
        lines.append(
            f"Dialogue: 0,{ass_time(chunk_start)},{ass_time(chunk_end)},Caption,,0,0,0,,{text}"
        )
    with open(path, "w") as f:
        f.write(header + "\n".join(lines) + "\n")


def docker_ffmpeg(args, timeout=300):
    cmd = ["docker", "exec", CONTAINER, "ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return proc.returncode == 0, proc.stdout + proc.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--model", default="claude-sonnet-4-6")
    args = ap.parse_args()

    ep = args.episode_dir.rstrip("/")
    timeline_path = os.path.join(ep, "scripts", "media_timeline.json")
    transcript_path = os.path.join(ep, "scripts", "transcript.json")
    final_video_path = os.path.join(ep, "renders", "final_video.mp4")
    out_dir = os.path.join(ep, "renders", "shorts")
    meta_path = os.path.join(out_dir, "clips_metadata.json")

    for p, label in [(timeline_path, "media_timeline.json"), (transcript_path, "transcript.json"),
                      (final_video_path, "renders/final_video.mp4")]:
        if not os.path.exists(p):
            print(f"ERROR: {p} not found ({label} required)", file=sys.stderr)
            sys.exit(2)
    if not os.path.exists(PROMPT_PATH):
        print(f"ERROR: {PROMPT_PATH} not found", file=sys.stderr)
        sys.exit(2)

    timeline = json.load(open(timeline_path))
    scenes = timeline.get("scenes", [])
    if not scenes:
        print("ERROR: media_timeline.json has no scenes", file=sys.stderr)
        sys.exit(2)
    scene_by_id = {s["scene_id"]: s for s in scenes}
    scene_order = {s["scene_id"]: i for i, s in enumerate(scenes)}

    system = open(PROMPT_PATH).read()
    agent_input = {
        "topic": timeline.get("topic"),
        "scenes": [
            {"scene_id": s["scene_id"], "act": s.get("act"), "narration_text": s.get("narration_text")}
            for s in scenes
        ],
    }
    prompt = "Your input:\n\n" + json.dumps(agent_input, indent=2)

    print(f"Selecting clips: {os.path.basename(ep)}")
    print(f"  topic: {timeline.get('topic')}")
    print(f"  scenes: {len(scenes)}")

    try:
        resp = call_bridge(system, prompt, args.model)
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: bridge call failed — {e}", file=sys.stderr)
        print("       Is the bridge running? cd /Users/jneal/n8n_projects/ClaudeBridge "
              "&& python3 claude-bridge.py", file=sys.stderr)
        sys.exit(2)

    if resp.get("exitCode"):
        print(f"ERROR: bridge returned an error — {resp.get('error', '')[:300]}", file=sys.stderr)
        sys.exit(2)

    try:
        parsed = extract_json(resp.get("output", ""))
    except json.JSONDecodeError as e:
        print(f"ERROR: could not parse agent output as JSON — {e}", file=sys.stderr)
        sys.exit(1)

    clips = parsed.get("clips")
    if not isinstance(clips, list) or not (2 <= len(clips) <= 3):
        print(f"ERROR: expected 2-3 clips, got {clips!r}", file=sys.stderr)
        sys.exit(1)

    transcript = json.load(open(transcript_path))
    os.makedirs(out_dir, exist_ok=True)

    results = []
    for i, c in enumerate(clips, start=1):
        sid, eid = c.get("start_scene_id"), c.get("end_scene_id")
        caption = (c.get("hook_caption") or "").strip()
        reasoning = (c.get("reasoning") or "").strip()

        if sid not in scene_by_id or eid not in scene_by_id:
            print(f"  clip {i}: SKIPPED — unknown scene_id ({sid} / {eid})")
            continue
        if scene_order[sid] > scene_order[eid]:
            print(f"  clip {i}: SKIPPED — start_scene_id after end_scene_id")
            continue

        # Raw (unshifted) timestamps -- these match transcript.json's word offsets and are
        # what caption timing is built relative to.
        raw_start_s = scene_by_id[sid]["audio_in"]
        raw_end_s = scene_by_id[eid]["audio_out"]
        duration = raw_end_s - raw_start_s
        if not (MIN_CLIP_S <= duration <= MAX_CLIP_S):
            print(f"  clip {i}: SKIPPED — duration {duration:.1f}s outside "
                  f"[{MIN_CLIP_S}, {MAX_CLIP_S}]s sanity bounds ({sid}..{eid})")
            continue

        # Where that same narration actually sits in final_video.mp4 -- what we cut from.
        start_s = raw_start_s + FINAL_VIDEO_AUDIO_OFFSET_S
        end_s = raw_end_s + FINAL_VIDEO_AUDIO_OFFSET_S + END_PAD_S

        start_ms, end_ms = int(raw_start_s * 1000), int(raw_end_s * 1000)
        words = build_caption_words(transcript, start_ms, end_ms)

        clip_name = f"clip_{i:02d}"
        raw_cut = os.path.join(out_dir, f"{clip_name}_raw.mp4")
        ass_path = os.path.join(out_dir, f"{clip_name}.ass")
        final_clip = os.path.join(out_dir, f"{clip_name}.mp4")

        # Step A: accurate trim (post-seek for frame accuracy on a re-encoded clip length).
        ok, log = docker_ffmpeg([
            "-i", final_video_path, "-ss", f"{start_s:.3f}", "-to", f"{end_s:.3f}",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac",
            raw_cut,
        ])
        if not ok:
            print(f"  clip {i}: FAILED at trim step — {log[-400:]}")
            continue

        # Step B: captions, relative to clip start.
        build_ass_file(words, start_ms, ass_path)

        # Step C: vertical reformat (blur-pad, preserves full frame) + burn captions.
        vf = (
            f"split[bg][fg];"
            f"[bg]scale={CLIP_W}:{CLIP_H}:force_original_aspect_ratio=increase,"
            f"crop={CLIP_W}:{CLIP_H},gblur=sigma=20[bg];"
            f"[fg]scale={CLIP_W}:-2[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
            f"subtitles={ass_path}"
        )
        ok, log = docker_ffmpeg([
            "-i", raw_cut, "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac",
            final_clip,
        ])
        if not ok:
            print(f"  clip {i}: FAILED at vertical/caption step — {log[-400:]}")
            continue

        try:
            os.remove(raw_cut)
        except OSError:
            pass

        print(f"  clip {i}: {sid}..{eid}  {duration:.1f}s  -> {final_clip}")
        results.append({
            "clip": clip_name,
            "file": final_clip,
            "start_scene_id": sid,
            "end_scene_id": eid,
            "duration_seconds": round(duration, 1),
            "hook_caption": caption,
            "reasoning": reasoning,
        })

    if not results:
        print("❌ No clips extracted successfully.", file=sys.stderr)
        sys.exit(1)

    json.dump({"episode": os.path.basename(ep), "clips": results}, open(meta_path, "w"), indent=2)
    print(f"\n✅ {len(results)}/{len(clips)} clips written → {out_dir}")
    print(f"   Metadata (captions for manual upload) → {meta_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
