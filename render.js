#!/usr/bin/env node
/**
 * Ruins Untold Phase 3: Video Render Script
 * Usage: node render.js <project_dir>
 *
 * Reads media_timeline.json, creates scene clips from generated images/videos,
 * assembles them with xfade cross-dissolves, mixes audio, and outputs final_video.mp4.
 *
 * Requirements: ffmpeg must be on PATH (no ffprobe needed)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Configuration ─────────────────────────────────────────────────────────────
const FPS = 30;
const XFADE_DURATION = 0.75;    // cross-dissolve duration in seconds
const XFADE_BATCH_SIZE = 25;    // max clips per xfade pass (single FFmpeg command)
const KEN_BURNS_ZOOM = 1.04;    // maximum zoom factor for images (1.0 = no zoom)
const ENCODE_PRESET = 'fast';   // libx264 preset
const ENCODE_CRF = 22;          // quality: 18=high, 22=medium, 28=low
const NARRATION_PAUSE_SECONDS = 1.5;  // silence before narration begins (musical lead-in / opening pause)
const NARRATION_TAIL_SECONDS = 2.0;   // breathing room after narration ends (musical outro / no abrupt cut)
const JCUT_SECONDS = 1.5;             // J-cut: narrator enters this many seconds BEFORE the video cuts to the
                                       // associated scene. The video timeline is shifted by
                                       // NARRATION_PAUSE_SECONDS + JCUT_SECONDS; the narration adelay is only
                                       // NARRATION_PAUSE_SECONDS — so the narrator always rides 1.5s early.
                                       // Set to 0 to disable J-cuts and return to straight cuts.

// ── Utilities ─────────────────────────────────────────────────────────────────
const EXEC_OPTS = { shell: '/bin/sh', maxBuffer: 200 * 1024 * 1024 };

function run(cmd, exitOnError = true) {
  try {
    const out = execSync(cmd, EXEC_OPTS);
    return { ok: true, stdout: out.toString(), stderr: '' };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    const stdout = e.stdout ? e.stdout.toString() : '';
    if (exitOnError) {
      console.error(`[ERROR] ${cmd.substring(0, 150)}`);
      console.error(stderr.slice(-800));
      process.exit(1);
    }
    return { ok: false, stdout, stderr };
  }
}

// ffmpeg -i always exits non-zero when no output file is given; duration is in stderr
function getDuration(filePath) {
  const r = run(`ffmpeg -i "${filePath}" 2>&1 | grep -m1 Duration`, false);
  const text = r.stdout + r.stderr;
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  return 0;
}

function ts() {
  return new Date().toISOString().substring(11, 19);
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

// ── Asset Resolution ──────────────────────────────────────────────────────────
function resolveAsset(scene, projectDir) {
  const { visual_type = 'image', scene_id = '', sequence = 0, asset_path } = scene;

  // 1. Explicit asset_path in the timeline
  if (asset_path && fs.existsSync(asset_path)) {
    const ext = path.extname(asset_path).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext);
    return { path: asset_path, type: isVideo ? 'video' : 'image' };
  }

  // 2. Image scenes — images/image_{scene_id}.png or images/image_scene_NNN.png
  if (visual_type === 'image' || visual_type === 'pinned_image') {
    const candidates = [
      path.join(projectDir, 'images', `image_${scene_id}.png`),
      path.join(projectDir, 'images', `image_${scene_id}.jpg`),
      path.join(projectDir, 'images', `image_scene_${String(sequence).padStart(3, '0')}.png`),
      path.join(projectDir, 'images', `image_scene_${String(sequence).padStart(3, '0')}.jpg`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { path: c, type: 'image' };
    }
  }

  // 3. Video scenes — videos/video_{scene_id}.mp4 or videos/video_NNNN.mp4
  if (visual_type === 'video' || visual_type === 'pinned_video') {
    const vidDir = path.join(projectDir, 'videos');
    if (fs.existsSync(vidDir)) {
      const candidates = [
        path.join(vidDir, `video_${scene_id}.mp4`),
        path.join(vidDir, `video_scene_${String(sequence).padStart(3, '0')}.mp4`),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return { path: c, type: 'video' };
      }
      // Also accept any mp4 matching the sequence index from video_manifest
      // (Phase 2 names them video_0001.mp4, video_0002.mp4, …)
      // We don't have the manifest index here, so skip sequential lookup
    }
  }

  return null;
}

// Pre-render completeness gate: walk every scene and confirm resolveAsset() can find
// a real source file for it. Phase 2 can silently drop a scene from its generation
// queue (Cahokia scene_186 — video_scene_186.mp4 was never produced), and without this
// check the render just plows ahead for 1-2 hours and quietly fills the hole with a
// black screen, recording it only as `assets_missing: N` in render_complete.json — a
// file nobody reads until after the render finishes. This surfaces it loudly, up front,
// before any encoding work starts.
function checkAssetCompleteness(scenes, projectDir) {
  const missing = [];
  scenes.forEach((scene, i) => {
    const sceneId = scene.scene_id || `scene_${String(i).padStart(3, '0')}`;
    if (!resolveAsset(scene, projectDir)) {
      missing.push({
        sceneId,
        sequence:   scene.sequence,
        visualType: scene.visual_type || 'image',
        narration:  (scene.narration_text || '').slice(0, 70),
      });
    }
  });
  return missing;
}

// ── Scene Clip Creation ───────────────────────────────────────────────────────
function createImageClip(imagePath, duration, outputPath) {
  // Avoid zoompan (causes sub-pixel jitter). Instead: pre-scale to zoom headroom,
  // then animate the crop window from maxW×maxH down to 1920×1080 over the duration.
  // round() on crop dimensions forces integer pixel positions — no jitter.
  const maxW = Math.ceil(1920 * KEN_BURNS_ZOOM / 2) * 2;
  const maxH = Math.ceil(1080 * KEN_BURNS_ZOOM / 2) * 2;
  const d    = (KEN_BURNS_ZOOM - 1.0).toFixed(6);
  const dur  = duration.toFixed(6);

  const cropW = `round(1920*(1+${d}*(1-min(t,${dur})/${dur})))`;
  const cropH = `round(1080*(1+${d}*(1-min(t,${dur})/${dur})))`;

  const vf = [
    `scale=${maxW}:${maxH}:force_original_aspect_ratio=increase`,
    `crop=${maxW}:${maxH}`,
    `crop=w='${cropW}':h='${cropH}'`,
    `scale=1920:1080`,
    `setsar=1`,
  ].join(',');

  const cmd = [
    `ffmpeg -y -loop 1 -framerate ${FPS} -i "${imagePath}"`,
    `-vf "${vf}"`,
    `-t ${duration.toFixed(3)} -r ${FPS}`,
    `-c:v libx264 -preset ${ENCODE_PRESET} -crf ${ENCODE_CRF} -pix_fmt yuv420p -an`,
    `"${outputPath}"`,
  ].join(' ');

  return run(cmd, false);
}

// Build a chain of atempo filters for values outside the [0.5, 2.0] range.
function buildAtempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  parts.push(`atempo=${s.toFixed(6)}`);
  return parts.join(',');
}

function createVideoClip(videoPath, duration, outputPath, includeAudio, audioLevelDb, pinned = false) {
  const volFactor = Math.pow(10, (audioLevelDb || 0) / 20).toFixed(5);

  // Pinned clips play at natural speed — their duration was already capped to the actual
  // clip length in main(), so no slowdown is needed or wanted.
  // For non-pinned clips that are shorter than required, slow them down to fill the slot.
  const srcDur = getDuration(videoPath);
  const slowFactor = (!pinned && srcDur > 0 && srcDur < duration - 0.1) ? duration / srcDur : 1.0;

  const vfParts = [];
  if (slowFactor > 1.001) vfParts.push(`setpts=${slowFactor.toFixed(6)}*PTS`);
  vfParts.push('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1');

  let audioArgs;
  if (includeAudio) {
    const atempoChain = buildAtempoChain(1.0 / slowFactor);
    audioArgs = `-af "${atempoChain},volume=${volFactor}" -c:a aac -b:a 192k`;
  } else {
    audioArgs = '-an';
  }

  const cmd = [
    `ffmpeg -y -i "${videoPath}"`,
    `-vf "${vfParts.join(',')}"`,
    `-t ${duration.toFixed(3)} -r ${FPS}`,
    `-c:v libx264 -preset ${ENCODE_PRESET} -crf ${ENCODE_CRF} -pix_fmt yuv420p`,
    audioArgs,
    `"${outputPath}"`,
  ].join(' ');

  return run(cmd, false);
}

function createBlackClip(duration, outputPath) {
  const cmd = [
    `ffmpeg -y -f lavfi -i "color=c=black:s=1920x1080:r=${FPS}"`,
    `-t ${duration.toFixed(3)}`,
    `-c:v libx264 -preset ${ENCODE_PRESET} -crf ${ENCODE_CRF} -pix_fmt yuv420p -an`,
    `"${outputPath}"`,
  ].join(' ');
  return run(cmd, false).ok;
}

function createSceneClip(scene, outputPath, projectDir) {
  const duration = Math.max(scene.duration_seconds || 5.0, 0.5);
  const includeAudio = scene.include_clip_audio || false;
  const audioLevelDb = scene.clip_audio_level_db || 0;

  const asset = resolveAsset(scene, projectDir);

  if (asset) {
    let result;
    const isPinned = (scene.visual_type === 'pinned_video' || scene.visual_type === 'pinned_image');
    if (asset.type === 'image') {
      result = createImageClip(asset.path, duration, outputPath);
    } else {
      result = createVideoClip(asset.path, duration, outputPath, includeAudio, audioLevelDb, isPinned);
    }
    if (result.ok) return { ok: true, assetUsed: asset.path };

    // Asset existed and resolved fine, but ffmpeg failed to encode it — surface the
    // reason before silently falling back to black. (Cahokia scene_013 fell back to
    // BLACK with zero trace of why; this is the fix for that blind spot.)
    const reason = (result.stderr || '').trim().split('\n').filter(Boolean).slice(-6).join('\n    ');
    log(`  [WARN] ${scene.scene_id || '?'}: ffmpeg failed to encode ${path.basename(asset.path)} — falling back to BLACK`);
    if (reason) log(`    ffmpeg error (last lines):\n    ${reason}`);
  }

  // Fallback: black screen
  const ok = createBlackClip(duration, outputPath);
  return { ok, assetUsed: null };
}

// ── Video Assembly ────────────────────────────────────────────────────────────
function xfadeBatch(clipPaths, clipDurations, outputPath) {
  const n = clipPaths.length;
  if (n === 1) { fs.copyFileSync(clipPaths[0], outputPath); return true; }

  const inputsStr = clipPaths.map(p => `-i "${p}"`).join(' ');
  const filterParts = [];
  let cumulative = 0.0;
  let lastLabel = '[0:v]';

  for (let i = 1; i < n; i++) {
    cumulative += clipDurations[i - 1];
    const rawOffset = cumulative - i * XFADE_DURATION;
    const offset = Math.max(rawOffset, clipDurations[i - 1] * 0.05);
    const outLabel = i < n - 1 ? `[xf${i}]` : '[vout]';
    filterParts.push(
      `${lastLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DURATION.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`
    );
    lastLabel = outLabel;
  }

  const cmd = [
    `ffmpeg -y ${inputsStr}`,
    `-filter_complex "${filterParts.join('; ')}"`,
    `-map "[vout]"`,
    `-c:v libx264 -preset ${ENCODE_PRESET} -crf ${ENCODE_CRF} -pix_fmt yuv420p`,
    `"${outputPath}"`,
  ].join(' ');

  return run(cmd, false).ok;
}

function assembleWithXfade(clipPaths, clipDurations, outputPath) {
  const n = clipPaths.length;
  if (n === 0) return false;
  if (n === 1) { fs.copyFileSync(clipPaths[0], outputPath); return true; }

  const renderDir = path.dirname(outputPath);

  // Small enough for a single FFmpeg xfade pass
  if (n <= XFADE_BATCH_SIZE) {
    return xfadeBatch(clipPaths, clipDurations, outputPath);
  }

  // Too many clips for one command — split into batches, xfade each, then xfade segments together
  const numBatches = Math.ceil(n / XFADE_BATCH_SIZE);
  log(`  Batched xfade: ${n} clips → ${numBatches} segments of ≤${XFADE_BATCH_SIZE}`);

  const segPaths = [];
  for (let b = 0; b < numBatches; b++) {
    const start = b * XFADE_BATCH_SIZE;
    const end   = Math.min(start + XFADE_BATCH_SIZE, n);
    const segPath = path.join(renderDir, `xfade_seg_${String(b).padStart(3, '0')}.mp4`);
    if (fs.existsSync(segPath)) fs.unlinkSync(segPath);

    log(`    Segment ${b + 1}/${numBatches}: clips ${start + 1}–${end}`);
    const ok = xfadeBatch(clipPaths.slice(start, end), clipDurations.slice(start, end), segPath);
    if (!ok) {
      log(`    Segment ${b + 1} xfade failed — aborting batched xfade`);
      segPaths.forEach(s => { try { fs.unlinkSync(s); } catch(e) {} });
      return false;
    }
    segPaths.push(segPath);
  }

  // Apply xfade crossfades across all batch segments so there are no hard cuts at batch boundaries.
  // getDuration() on each segment gives the actual encoded length; xfadeBatch() computes offsets
  // the same way it does for individual clips — so every batch-first scene becomes fully visible
  // at exactly its visual_in time in the final output.
  log(`  Applying xfade across ${segPaths.length} batch segments (no hard cuts)...`);
  const segDurations = segPaths.map(p => getDuration(p));
  const ok = xfadeBatch(segPaths, segDurations, outputPath);
  segPaths.forEach(s => { try { fs.unlinkSync(s); } catch(e) {} });
  return ok;
}

function assembleConcatFallback(clipPaths, outputPath) {
  log('  Falling back to simple concat (no transitions)...');
  const concatFile = outputPath + '.txt';
  fs.writeFileSync(concatFile, clipPaths.map(p => `file '${path.resolve(p)}'`).join('\n'));

  const cmd = [
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}"`,
    `-c:v libx264 -preset ${ENCODE_PRESET} -crf ${ENCODE_CRF} -pix_fmt yuv420p`,
    `"${outputPath}"`,
  ].join(' ');

  const r = run(cmd, false);
  if (fs.existsSync(concatFile)) try { fs.unlinkSync(concatFile); } catch(e) {}
  return r.ok;
}

// ── Audio Mix ─────────────────────────────────────────────────────────────────
function mixAudio(timeline, projectDir, outputPath, totalDuration) {
  const voPath = path.join(projectDir, 'audio', 'voiceover_final.mp3');
  if (!fs.existsSync(voPath)) {
    log(`[WARN] voiceover_final.mp3 not found`);
    return false;
  }

  const musicDir = path.join(projectDir, 'music');
  const sfxDir   = path.join(projectDir, 'sfx');

  const inputs      = [`-i "${voPath}"`];
  const filterParts = [];
  let inputIdx = 1;

  // Narration pause + tail-pad: delay the voiceover so music can establish before the
  // narrator begins, AND pad it with silence out to `totalDuration` (the assembled video's
  // length, which now includes [TAIL-PAD]'s extra seconds at the end).
  //
  // Why the apad is load-bearing, not cosmetic: `amix` below uses `duration=first`, which
  // makes the MIXED OUTPUT'S length exactly equal to this first input's length — full stop.
  // It ignores how long any other input runs, and critically, the `-t totalDuration` cap
  // a few lines down can only ever TRIM the output, never extend it. Without the apad here,
  // the raw delayed voiceover (1.5s silence + its own runtime) is shorter than
  // `totalDuration` by however much [TAIL-PAD] just added — so `amix` truncates the whole
  // mix back down to the narration's natural end, and the final `-c:a copy -shortest` mux
  // then chops the VIDEO back down to match. That's exactly what neutered the very first
  // version of the [TAIL-PAD] fix: video_raw grew to the padded length as intended, but the
  // final output still landed within ~40ms of the narration's true end — because the audio
  // mix silently threw the padding away before `-shortest` ever got involved.
  //
  // `apad=whole_dur=<totalDuration>` pads this stream with silence up to that exact length,
  // so `amix=duration=first` naturally produces a mix that runs the full assembled-video
  // duration — buffer included — with no reliance on the trim-only `-t` cap downstream.
  const totalDurStr = totalDuration.toFixed(3);
  let voLabel = '[0:a]';
  if (NARRATION_PAUSE_SECONDS > 0) {
    const pauseMs = Math.round(NARRATION_PAUSE_SECONDS * 1000);
    filterParts.push(`[0:a]adelay=${pauseMs}|${pauseMs},apad=whole_dur=${totalDurStr}[vox]`);
  } else {
    filterParts.push(`[0:a]apad=whole_dur=${totalDurStr}[vox]`);
  }
  voLabel = '[vox]';
  const mixLabels = [voLabel];

  // Music cues ---------------------------------------------------------------
  const musicFiles = fs.existsSync(musicDir)
    ? fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3')).sort().map(f => path.join(musicDir, f))
    : [];

  const musicCueList = timeline.music_cues || [];
  for (let ci = 0; ci < musicCueList.length; ci++) {
    const cue = musicCueList[ci];
    const musicPath = musicFiles.length
      ? (musicFiles[ci] || musicFiles[ci % musicFiles.length])
      : null;
    if (!musicPath) continue;

    const start    = cue.start_time ?? cue.start ?? 0;
    const end      = cue.end_time   ?? cue.end   ?? (start + 60);
    const dur      = end - start;
    const volDb    = cue.volume_db !== undefined ? cue.volume_db : -20;
    const fadeIn   = cue.fade_in_seconds  || 3.0;
    const fadeOut  = cue.fade_out_seconds || 4.0;
    const amp      = Math.pow(10, volDb / 20).toFixed(5);
    // Cues anchored at t=0 (e.g. music_intro) are meant to bridge the lead-in INTO the
    // narration — they should keep playing from frame one, not start LEAD_IN seconds late
    // and leave the pause silent. Everything else is tied to a specific narrative beat
    // that itself now lands (NARRATION_PAUSE_SECONDS + JCUT_SECONDS) later in the assembled
    // video, so it shifts by the same amount to stay aligned with the video. Music does NOT
    // get the J-cut — only the narrator rides early. See [LEAD-IN] in main().
    const shiftedStart = start > 0.01 ? start + NARRATION_PAUSE_SECONDS + JCUT_SECONDS : start;
    const delayMs  = Math.round(shiftedStart * 1000);
    const label    = `[mu${inputIdx}]`;

    // Outro cues: take the TAIL of the generated track instead of the head.
    //
    // Generated tracks (Suno) run several minutes; cue durations are usually a small
    // slice of that (Cahokia: a 44s outro cue carved from a 7.5min / 452s track). The
    // existing `atrim=end=<cue_dur>` always grabs the first N seconds — for every cue
    // that's a freshly-building intro with nowhere natural to land in N seconds, so it
    // just stops mid-phrase. The volume afade-out smooths the *level* but can't fix the
    // *phrasing* — it reads as "cut off," and the outro is the one the viewer always
    // notices because it's the last thing they hear.
    //
    // The tail of the track is far more likely to already contain the track's own
    // musical resolution or natural fade-out (that's how songs end), so grabbing the
    // last N seconds instead gives us something that actually resolves rather than
    // something we have to fade-cut mid-idea. Cheap, no re-generation needed.
    const isOutro = (cue.act === 'outro' || /outro/i.test(cue.cue_id || '') ||
                     ci === musicCueList.length - 1);
    let trimFilter;
    if (isOutro) {
      const srcDur    = getDuration(musicPath);
      const tailStart = (srcDur > dur) ? (srcDur - dur) : 0;
      trimFilter = `atrim=start=${tailStart.toFixed(3)}:end=${srcDur.toFixed(3)}`;
      log(`  [MUSIC] ${cue.cue_id || `cue_${ci}`} (outro): using tail ${tailStart.toFixed(1)}–${srcDur.toFixed(1)}s of ${path.basename(musicPath)} (${srcDur.toFixed(1)}s total) instead of the head — more likely to land on a natural resolution`);
    } else {
      trimFilter = `atrim=end=${dur.toFixed(3)}`;
    }

    inputs.push(`-i "${musicPath}"`);
    filterParts.push(
      `[${inputIdx}:a]${trimFilter},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${fadeIn.toFixed(2)},` +
      `afade=t=out:st=${Math.max(dur - fadeOut, 0).toFixed(2)}:d=${fadeOut.toFixed(2)},` +
      `volume=${amp},adelay=${delayMs}|${delayMs}${label}`
    );
    mixLabels.push(label);
    inputIdx++;
  }

  // SFX cues -----------------------------------------------------------------
  const sfxFiles = fs.existsSync(sfxDir)
    ? fs.readdirSync(sfxDir).filter(f => f.endsWith('.mp3')).sort().map(f => path.join(sfxDir, f))
    : [];

  for (let ci = 0; ci < (timeline.sfx_cues || []).length; ci++) {
    const cue     = timeline.sfx_cues[ci];
    if (cue.enabled === false) continue;
    const sfxPath = sfxFiles.length
      ? (sfxFiles[ci] || sfxFiles[ci % sfxFiles.length])
      : null;
    if (!sfxPath) continue;

    const start   = cue.start !== undefined ? cue.start : (cue.start_time || 0);
    const volDb   = cue.volume_db  !== undefined ? cue.volume_db : -28;
    const amp     = Math.pow(10, volDb / 20).toFixed(5);
    // Same video-alignment rule as music cues — shifts by the full (pause + J-cut) offset so
    // SFX land on the correct video frame, not 1.5s early with the narrator.
    // See comment above and [LEAD-IN] in main().
    const shiftedStart = start > 0.01 ? start + NARRATION_PAUSE_SECONDS + JCUT_SECONDS : start;
    const delayMs = Math.round(shiftedStart * 1000);
    const label   = `[sx${inputIdx}]`;

    inputs.push(`-i "${sfxPath}"`);
    filterParts.push(
      `[${inputIdx}:a]volume=${amp},adelay=${delayMs}|${delayMs}${label}`
    );
    mixLabels.push(label);
    inputIdx++;
  }

  // Pinned clip audio --------------------------------------------------------
  // Scenes with include_clip_audio:true have their video clip audio mixed in
  // at their visual_in timestamp. The xfade assembler drops clip audio tracks,
  // so we re-inject them here from the original asset file.
  for (const sc of (timeline.scenes || [])) {
    if (!sc.include_clip_audio) continue;
    const asset = resolveAsset(sc, projectDir);
    if (!asset || asset.type !== 'video') continue;

    const start   = sc.visual_in !== undefined ? sc.visual_in : (sc.audio_in || 0);
    const volDb   = sc.clip_audio_level_db !== undefined ? sc.clip_audio_level_db : 0;
    const amp     = Math.pow(10, volDb / 20).toFixed(5);
    // Pinned-clip audio must start exactly when the clip's VIDEO starts playing — which is
    // XFADE_DURATION before the scene becomes fully visible. FFmpeg xfade plays the incoming
    // clip from frame 0 at the xfade START (not the end), so if we position the audio at the
    // fully-visible time (as music/SFX do) the audio lands XFADE_DURATION seconds late.
    //
    // Exception: batch-first scenes (k % XFADE_BATCH_SIZE === 0, i.e. k=25,50,75...) are
    // concat-joined between batches — no incoming xfade — so their audio needs no correction.
    // k=0 (scene_001) can never have include_clip_audio, so the only real risk is k=25,50…
    //
    // The full shift is (NARRATION_PAUSE_SECONDS + JCUT_SECONDS) to match the video timeline,
    // then we pull back by the xfade correction so audio and video frame 0 land together.
    const kIndex      = (sc.sequence || 1) - 1;   // sc.sequence is 1-based
    const isBatchFirst = kIndex % XFADE_BATCH_SIZE === 0;
    const xfadeAdj    = isBatchFirst ? 0 : XFADE_DURATION;
    const shiftedStart = Math.max(0, start + NARRATION_PAUSE_SECONDS + JCUT_SECONDS - xfadeAdj);
    const delayMs = Math.round(shiftedStart * 1000);
    const label   = `[ca${inputIdx}]`;

    inputs.push(`-i "${asset.path}"`);
    filterParts.push(
      `[${inputIdx}:a]volume=${amp},adelay=${delayMs}|${delayMs}${label}`
    );
    mixLabels.push(label);
    inputIdx++;
    log(`  Pinned clip audio: ${path.basename(asset.path)} at ${shiftedStart.toFixed(2)}s (${volDb}dB)`);
  }

  // Build mix ----------------------------------------------------------------
  const inputsStr = inputs.join(' ');

  if (mixLabels.length === 1 && filterParts.length === 0) {
    // Dead path under the current config (the [vox] apad filter above is always pushed,
    // so filterParts is never empty) — kept only as defensive coverage if that ever
    // changes. Mirrors the apad-to-totalDuration fix above for the same reason: a bare
    // `-t totalDuration` here can only TRIM, never extend, so without padding this would
    // reproduce the exact truncation bug [TAIL-PAD]/apad were added to fix.
    return run(
      `ffmpeg -y -i "${voPath}" -af "apad=whole_dur=${totalDuration.toFixed(3)}" -t ${totalDuration.toFixed(3)} -c:a aac -b:a 192k "${outputPath}"`,
      false
    ).ok;
  }

  const nMix = mixLabels.length;
  const fc = [
    ...filterParts,
    `${mixLabels.join('')}amix=inputs=${nMix}:duration=first:dropout_transition=3:normalize=0[aout]`,
  ].join('; ');

  const cmd = [
    `ffmpeg -y ${inputsStr}`,
    `-filter_complex "${fc}"`,
    `-map "[aout]"`,
    `-t ${totalDuration.toFixed(3)}`,
    `-c:a aac -b:a 192k`,
    `"${outputPath}"`,
  ].join(' ');

  return run(cmd, false).ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const projectDir = process.argv[2];
  if (!projectDir || !fs.existsSync(projectDir)) {
    console.error('Usage: node render.js <project_dir>');
    process.exit(1);
  }

  const timelinePath = path.join(projectDir, 'scripts', 'media_timeline.json');
  if (!fs.existsSync(timelinePath)) {
    console.error(`media_timeline.json not found: ${timelinePath}`);
    process.exit(1);
  }

  const timeline     = JSON.parse(fs.readFileSync(timelinePath, 'utf-8'));
  const scenes       = timeline.scenes || [];
  const totalDur     = timeline.total_duration_seconds || 0;
  const episodeTitle = timeline.episode_title || path.basename(projectDir);

  const renderDir = path.join(projectDir, 'renders');
  const clipsDir  = path.join(renderDir, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  // Normalize field names: accept audio_in/audio_out as fallback for visual_in/visual_out,
  // and accept duration (from segmentation agent) as fallback for duration_seconds.
  // This makes the render robust to different field naming conventions from upstream agents.
  scenes.forEach(sc => {
    if (typeof sc.visual_in !== 'number' && typeof sc.audio_in === 'number')
      sc.visual_in = sc.audio_in;
    if (typeof sc.visual_out !== 'number' && typeof sc.audio_out === 'number')
      sc.visual_out = sc.audio_out;
    if (typeof sc.duration_seconds !== 'number' && typeof sc.duration === 'number')
      sc.duration_seconds = sc.duration;
    if (typeof sc.duration_seconds !== 'number' &&
        typeof sc.audio_out === 'number' && typeof sc.audio_in === 'number')
      sc.duration_seconds = sc.audio_out - sc.audio_in;
  });

  // ── Pre-render completeness gate ─────────────────────────────────────────
  // Fail loud and fast (before ~1-2 hours of encoding) if any scene has no
  // resolvable source asset. Pass --allow-missing-assets to proceed anyway and
  // let those scenes fall back to black — useful if you're knowingly patching
  // a gap later, or just want the run to not block on it.
  const missingAssets = checkAssetCompleteness(scenes, projectDir);
  if (missingAssets.length > 0) {
    console.error(`\n[GATE] ${missingAssets.length} of ${scenes.length} scene(s) have NO resolvable source asset — these would silently render as BLACK SCREENS:`);
    for (const m of missingAssets) {
      const trunc = m.narration.length === 70 ? '…' : '';
      console.error(`  - ${m.sceneId} (seq ${m.sequence}, ${m.visualType}): "${m.narration}${trunc}"`);
    }
    console.error(`\nThis is exactly what happened with Cahokia scene_186 — Phase 2 dropped it from`);
    console.error(`its generation queue and the render quietly filled the hole with black, two`);
    console.error(`hours before anyone noticed. Check the Phase 2 generation queue / video & image`);
    console.error(`folders for the scene(s) above, or add an asset_path override in media_timeline.json.`);
    console.error(`\nTo render anyway with black-screen placeholders for these scenes, re-run with`);
    console.error(`--allow-missing-assets.\n`);
    if (!process.argv.includes('--allow-missing-assets')) {
      process.exit(1);
    }
    console.error(`[GATE] --allow-missing-assets set — proceeding with ${missingAssets.length} black-screen placeholder(s).\n`);
  }

  // Derive clip durations from visual_in timestamps so each scene appears at exactly
  // the right moment in the assembled video after xfade dissolves.
  //
  // In xfadeBatch(), clip k (0-indexed) becomes fully visible at output time:
  //   T[0] = 0
  //   T[k] = sum(duration[0..k-1]) - (k-1)*XFADE_DURATION    (k >= 1)
  //
  // Solving so T[k] = visual_in[k]:
  //   duration[0]   = visual_in[1] - visual_in[0]
  //   duration[k]   = visual_in[k+1] - visual_in[k] + XFADE_DURATION   (k = 1..n-2)
  //   duration[n-1] = visual_out[n-1] - visual_in[n-1]
  const allHaveTimestamps = scenes.length > 1 &&
    scenes.every(sc => typeof sc.visual_in === 'number' && typeof sc.visual_out === 'number');

  if (allHaveTimestamps) {
    console.log('[TIMING] Computing clip durations from visual_in timestamps');
    scenes[0].duration_seconds = Math.max(scenes[1].visual_in - scenes[0].visual_in, 0.5);
    for (let k = 1; k < scenes.length - 1; k++) {
      // Every clip (including batch-first) gets XFADE_DURATION added so that after xfade
      // transitions — both within batches AND between batch segments — each scene becomes
      // fully visible at exactly its visual_in timestamp in the assembled output.
      scenes[k].duration_seconds = Math.max(
        scenes[k + 1].visual_in - scenes[k].visual_in + XFADE_DURATION, 0.5
      );
    }
    const last = scenes[scenes.length - 1];
    last.duration_seconds = Math.max(last.visual_out - last.visual_in, 0.5);

    // Drift correction: segmentation agent estimates timestamps before the actual voiceover
    // is produced. Scale all derived durations (and music/sfx cue timestamps) to match the
    // real voiceover duration so video_raw and audio_mix stay in sync.
    //
    // NOTE: the narration lead-in pause is intentionally NOT folded into this target. It
    // used to be (targetDur = voDurActual + NARRATION_PAUSE_SECONDS), which diluted the
    // pause proportionally across all 216 scene durations — a few milliseconds each —
    // while the narration track itself got the FULL pause via a single adelay() in
    // mixAudio(). That mismatch silently desynced video from narration for the whole
    // episode (worst at the start, before the per-scene drift had accumulated enough to
    // mask it — exactly the "video feels ahead of the narrator" symptom). The pause is
    // instead applied as one fixed extension to the OPENING clip's duration, after all
    // scaling is final — see [LEAD-IN] below — so every clip after it lands exactly
    // NARRATION_PAUSE_SECONDS later, matching where mixAudio() now plays narration, music
    // (cues that don't start at t=0), SFX, and pinned-clip audio.
    const voPathDrift = path.join(projectDir, 'audio', 'voiceover_final.mp3');
    if (fs.existsSync(voPathDrift)) {
      const voDurActual = getDuration(voPathDrift);
      if (voDurActual > 0) {
        const targetDur     = voDurActual;
        // Total xfade transitions = (n - 1): (n - numBatches) within batches + (numBatches - 1)
        // between batch segments. Simplifies to (n - 1) regardless of batch count.
        const xfadeReduction = (scenes.length - 1) * XFADE_DURATION;
        const sumSceneDur   = scenes.reduce((s, sc) => s + sc.duration_seconds, 0);
        const driftRatio    = (targetDur + xfadeReduction) / sumSceneDur;
        if (Math.abs(driftRatio - 1.0) > 0.001) {
          console.log(`[DRIFT] Scaling timestamp durations by ${driftRatio.toFixed(4)} (voiceover ${voDurActual.toFixed(1)}s → target ${targetDur.toFixed(1)}s)`);
          scenes.forEach(sc => { sc.duration_seconds *= driftRatio; });
          // Scale music/sfx cue timestamps proportionally so they stay in sync
          const timeScale = targetDur / (timeline.total_duration_seconds || targetDur);
          for (const cue of (timeline.music_cues || [])) {
            if (typeof cue.start     === 'number') cue.start     *= timeScale;
            if (typeof cue.end       === 'number') cue.end       *= timeScale;
            if (typeof cue.start_time === 'number') cue.start_time *= timeScale;
            if (typeof cue.end_time   === 'number') cue.end_time   *= timeScale;
          }
          for (const cue of (timeline.sfx_cues || [])) {
            if (typeof cue.start     === 'number') cue.start     *= timeScale;
            if (typeof cue.end       === 'number') cue.end       *= timeScale;
            if (typeof cue.start_time === 'number') cue.start_time *= timeScale;
            if (typeof cue.end_time   === 'number') cue.end_time   *= timeScale;
          }
        }
      }
    }
  } else {
    // Fallback: scale all durations proportionally to match actual voiceover length
    const voPathCheck = path.join(projectDir, 'audio', 'voiceover_final.mp3');
    if (fs.existsSync(voPathCheck) && scenes.length > 0) {
      const voDurActual = getDuration(voPathCheck);
      if (voDurActual > 0) {
        const sumSceneDur = scenes.reduce((s, sc) => s + (sc.duration_seconds || 0), 0);
        if (sumSceneDur > 0) {
          // Total xfade transitions = (n - 1): within batches + between batch segments.
          const xfadeReduction = (scenes.length - 1) * XFADE_DURATION;
          const driftRatio = (voDurActual + xfadeReduction) / sumSceneDur;
          if (Math.abs(driftRatio - 1.0) > 0.01) {
            console.log(`[SCALE] Fallback: scaling scenes by ${driftRatio.toFixed(4)}`);
            scenes.forEach(sc => { sc.duration_seconds = (sc.duration_seconds || 5.0) * driftRatio; });
          }
        } else {
          // All duration_seconds were 0/missing — assign equal shares of the voiceover length
          const perScene = voDurActual / scenes.length;
          console.log(`[SCALE] duration_seconds missing for all scenes — assigning ${perScene.toFixed(2)}s each`);
          scenes.forEach(sc => { sc.duration_seconds = perScene; });
        }
      }
    }
  }

  // Pinned-clip fixup: pinned clips play at natural speed (no slowdown).
  // If the allocated slot is longer than the clip's natural length, carry the excess
  // to the NEXT scene. This preserves the pinned clip's visual_in appearance time and
  // keeps all subsequent scenes correctly positioned.
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (sc.visual_type !== 'pinned_video' && sc.visual_type !== 'pinned_image') continue;
    const asset = resolveAsset(sc, projectDir);
    if (!asset) continue;
    const assetDur = getDuration(asset.path);
    if (assetDur <= 0) continue;
    const excess = sc.duration_seconds - assetDur;
    if (excess <= 0.1) continue;
    sc.duration_seconds = assetDur;
    if (i + 1 < scenes.length) {
      scenes[i + 1].duration_seconds += excess;
      console.log(`[PINNED] ${sc.scene_id}: ${assetDur.toFixed(2)}s clip in ${(assetDur + excess).toFixed(2)}s slot — ${excess.toFixed(2)}s carried to ${scenes[i + 1].scene_id}`);
    }
  }

  // [LEAD-IN] Opening pause: extend the OPENING clip by NARRATION_PAUSE_SECONDS only.
  //
  // This mirrors the adelay(NARRATION_PAUSE_SECONDS) applied to the narration track in
  // mixAudio() — music and the first visual establish on screen before the narrator's
  // voice enters at t = NARRATION_PAUSE_SECONDS (1.5s).
  //
  // The J-cut (JCUT_SECONDS = 1.5s) is already baked into every scene's visual_in
  // timestamp (visual_in = audio_in + JCUT_SECONDS). That means every scene's image
  // lands JCUT_SECONDS after its narration begins in the source timeline. Adding
  // NARRATION_PAUSE_SECONDS here shifts the video by 1.5s while narration is also
  // delayed 1.5s (adelay), so the relative image-vs-narration gap remains exactly
  // JCUT_SECONDS = 1.5s at every transition — the narrator always arrives 1.5s before
  // the video cuts to the matching image.
  //
  // DO NOT add JCUT_SECONDS here — it would double-count the J-cut offset and push
  // every image 3.0s behind narration instead of 1.5s.
  //
  // Applied LAST — after duration computation, drift correction, AND the pinned-clip
  // fixup — so it (a) isn't diluted by proportional scaling and (b) can't be silently
  // overwritten if the opening scene is ever pinned.
  const leadInSeconds = NARRATION_PAUSE_SECONDS;
  if (leadInSeconds > 0 && scenes.length > 0) {
    scenes[0].duration_seconds += leadInSeconds;
    console.log(`[LEAD-IN] Extending opening clip (${scenes[0].scene_id}) by ${leadInSeconds}s — narration enters at ${NARRATION_PAUSE_SECONDS}s, J-cut ${JCUT_SECONDS}s already in visual_in timestamps`);
  }

  // [TAIL-PAD] Mirror of [LEAD-IN]: extend the CLOSING clip by NARRATION_TAIL_SECONDS so
  // the video runs comfortably PAST where the narration ends, instead of ending the instant
  // it stops.
  //
  // Two problems this solves at once:
  //   1. CUTOFF BUG — `mixAudio()` receives the assembled video's duration as a hard
  //      `-t totalDuration` ceiling, and the final mux uses `-c:a copy -shortest`. So
  //      whatever the assembled video runs to is exactly where the audio gets truncated —
  //      including mid-word, if the video is even a fraction of a second short. And it
  //      WILL be short by a small, episode-varying amount: each of ~216 clips is encoded
  //      with `-r 30 -t <duration>` (frame-quantized), and those sub-frame rounding losses
  //      compound across clips and xfade batches into a net drift (observed: ~0.23s on the
  //      Cahokia render — just enough to clip the narrator's last word). Trying to land the
  //      assembled duration on the millisecond is fighting ffmpeg's frame quantization —
  //      a losing, episode-by-episode battle. Padding the tail swallows that drift with
  //      margin to spare, on every episode, regardless of which way the rounding breaks.
  //   2. ABRUPT ENDING — even when the timing lands exactly, cutting the instant the
  //      narrator stops talking feels jarring. A couple seconds of music/visual after the
  //      last line gives the episode a place to land instead of slamming into the outro.
  //
  // Applied LAST, same as [LEAD-IN] and for the same reason: after drift correction (so it
  // isn't diluted proportionally across all scenes) and after the pinned-clip fixup (so it
  // can't be silently overwritten if the closing scene is ever a pinned clip).
  if (NARRATION_TAIL_SECONDS > 0 && scenes.length > 0) {
    const lastScene = scenes[scenes.length - 1];
    lastScene.duration_seconds += NARRATION_TAIL_SECONDS;
    console.log(`[TAIL-PAD] Extending closing clip (${lastScene.scene_id}) by ${NARRATION_TAIL_SECONDS}s — video runs past narration's end so the ending isn't abrupt and the audio mix's "-shortest" cap can never truncate the last line`);
  }

  log('=== Ruins Untold Phase 3: Video Render ===');
  log(`Episode : ${episodeTitle}`);
  log(`Scenes  : ${scenes.length}  |  Duration: ${(totalDur / 60).toFixed(1)} min`);

  // ── STEP 1: Create scene clips ──────────────────────────────────────────────
  log('\nSTEP 1: Creating scene clips...');
  const clipPaths     = [];
  const clipDurations = [];
  let assetsFound   = 0;
  let assetsMissing = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene   = scenes[i];
    const sceneId = scene.scene_id || `scene_${String(i).padStart(3, '0')}`;
    const dur     = Math.max(scene.duration_seconds || 5.0, 0.5);
    const clip    = path.join(clipsDir, `clip_${String(i).padStart(4, '0')}_${sceneId}.mp4`);

    // Resume support: skip existing clips within ±0.5s of the expected duration.
    // Clips outside that window were built with different parameters — delete and regenerate.
    if (fs.existsSync(clip)) {
      const existDur = getDuration(clip);
      const expectedDur = Math.max(scene.duration_seconds || 5.0, 0.5);
      if (existDur > 0 && existDur >= expectedDur - 0.5 && existDur <= expectedDur + 0.5) {
        clipPaths.push(clip);
        clipDurations.push(existDur);
        continue;
      }
      log(`  Stale clip (${existDur.toFixed(2)}s, expected ${expectedDur.toFixed(2)}s) — regenerating ${sceneId}`);
      try { fs.unlinkSync(clip); } catch(e) {}
    }

    const tag    = `[${String(i + 1).padStart(3, ' ')}/${scenes.length}]`;
    const vtag   = scene.visual_type || 'image';
    const result = createSceneClip(scene, clip, projectDir);

    if (result.assetUsed) { assetsFound++;  }
    else                  { assetsMissing++; }

    const status = result.ok ? 'OK  ' : 'FAIL';
    const asset  = result.assetUsed ? path.basename(result.assetUsed) : 'BLACK';
    log(`  ${tag} ${status} ${vtag.padEnd(12)} ${sceneId.padEnd(18)} <- ${asset}`);

    const actualDur = result.ok ? getDuration(clip) : 0;
    clipPaths.push(clip);
    clipDurations.push(actualDur > 0 ? actualDur : dur);
  }

  log(`\nClips  : ${assetsFound} with assets, ${assetsMissing} black fallback`);

  // ── STEP 2: Assemble video ──────────────────────────────────────────────────
  const videoRaw = path.join(renderDir, 'video_raw.mp4');
  log('\nSTEP 2: Assembling video with cross-dissolve transitions...');

  let assembleOk = false;
  const existRawDur = fs.existsSync(videoRaw) ? getDuration(videoRaw) : 0;

  if (existRawDur > totalDur * 0.5) {
    log(`  video_raw.mp4 exists (${existRawDur.toFixed(1)}s) — skipping assembly`);
    assembleOk = true;
  } else {
    if (fs.existsSync(videoRaw)) fs.unlinkSync(videoRaw);
    log(`  Xfade assembly (${clipPaths.length} clips, batch size ${XFADE_BATCH_SIZE})...`);
    assembleOk = assembleWithXfade(clipPaths, clipDurations, videoRaw);
    if (!assembleOk) {
      assembleOk = assembleConcatFallback(clipPaths, videoRaw);
    }
  }

  if (!assembleOk || !fs.existsSync(videoRaw)) {
    log('ERROR: Video assembly failed'); process.exit(1);
  }

  const rawDur = getDuration(videoRaw);
  log(`  Assembled: ${rawDur.toFixed(1)}s`);

  // ── STEP 3: Audio mix ───────────────────────────────────────────────────────
  const audioMix = path.join(renderDir, 'audio_mix.aac');
  log('\nSTEP 3: Mixing audio...');

  let audioOk = mixAudio(timeline, projectDir, audioMix, rawDur);
  if (!audioOk) {
    log('  Audio mix failed — voiceover only');
    const voPath = path.join(projectDir, 'audio', 'voiceover_final.mp3');
    if (fs.existsSync(voPath)) {
      audioOk = run(`ffmpeg -y -i "${voPath}" -c:a aac -b:a 192k "${audioMix}"`, false).ok;
    }
  }
  if (audioOk) log(`  Audio mixed: ${path.basename(audioMix)}`);

  // ── STEP 4: Combine video + audio ───────────────────────────────────────────
  const finalOutput = path.join(renderDir, 'final_video.mp4');
  log('\nSTEP 4: Combining video + audio...');

  const combineCmd = audioOk && fs.existsSync(audioMix)
    ? `ffmpeg -y -i "${videoRaw}" -i "${audioMix}" -c:v copy -c:a copy -shortest "${finalOutput}"`
    : `ffmpeg -y -i "${videoRaw}" -c:v copy -an "${finalOutput}"`;

  run(combineCmd);

  const finalDur = getDuration(finalOutput);
  log(`\nFinal : ${finalOutput}`);
  log(`Dur   : ${finalDur.toFixed(1)}s (${(finalDur / 60).toFixed(1)} min)`);

  // ── Completion marker ───────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(renderDir, 'render_complete.json'),
    JSON.stringify({
      status:          'complete',
      episode_title:   episodeTitle,
      output_path:     finalOutput,
      duration_seconds: finalDur,
      scenes_rendered: scenes.length,
      assets_found:    assetsFound,
      assets_missing:  assetsMissing,
      completed_at:    new Date().toISOString(),
    }, null, 2)
  );

  log('\n=== RENDER COMPLETE ===');
}

main();
