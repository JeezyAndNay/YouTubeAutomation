"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startPhase1ForEpisode, startPhase2, startPhase3, rejectEpisode, approveScript, approveMediaPrompts, setYoutubeUrl, markEpisodeDone, resumeFromPause, generateThumbnailPrompt } from "@/app/actions/episodes";
import type { Episode, EpisodeOutputs, FileGroup, FailedAsset, PausedInfo, ThumbnailPrompt } from "@/lib/episodes";

// ── Artifact definitions ─────────────────────────────────────────────────────

type ArtifactType = "json" | "markdown" | "audio";

type ArtifactDef = {
  key: keyof EpisodeOutputs;
  label: string;
  path: string;
  type: ArtifactType;
  phase: 1 | 2 | 3;
};

const ARTIFACTS: ArtifactDef[] = [
  { key: "research",  label: "Research",        path: "scripts/research_package.json", type: "json",     phase: 1 },
  { key: "script",    label: "Script",           path: "scripts/script.md",             type: "markdown", phase: 1 },
  { key: "voice",     label: "Voice Package",    path: "audio/voice_package.json",      type: "json",     phase: 1 },
  { key: "timeline",  label: "Media Timeline",   path: "scripts/media_timeline.json",   type: "json",     phase: 2 },
  { key: "images",    label: "Image Manifest",   path: "scripts/image_manifest.json",   type: "json",     phase: 2 },
  { key: "videos",    label: "Video Manifest",   path: "scripts/video_manifest.json",   type: "json",     phase: 2 },
  { key: "voiceover", label: "Voiceover (MP3)",  path: "audio/voiceover_final.mp3",     type: "audio",    phase: 2 },
  { key: "metadata",  label: "Metadata",         path: "scripts/metadata_package.json", type: "json",     phase: 3 },
];

// ── Thumbnail templates (mirrors the ru-thumbnail skill / thumbnail_agent.md) ───────

const THUMBNAIL_TEMPLATES: { num: number; name: string; desc: string }[] = [
  { num: 1, name: "Revelation Shot",     desc: "Single artifact/object — dramatic vault lighting" },
  { num: 2, name: "Explorer Face",       desc: "Host face + location — reaction drives the click" },
  { num: 3, name: "Split Reveal",        desc: "Official story vs. suppressed truth, side by side" },
  { num: 4, name: "Mystery Object",      desc: "Single artifact on pure black — max impact small" },
  { num: 5, name: "Location Atmosphere", desc: "Full-bleed environment — cinematic, no face" },
];

// ── Previewable image extensions (rendered in the right pane on click) ──────

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

// ── JSON syntax highlighter ──────────────────────────────────────────────────

function JsonView({ raw }: { raw: string }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    pretty = raw;
  }

  // Tokenize
  type TokType = "key" | "string" | "number" | "keyword" | "other";
  type Tok = { t: TokType; v: string };
  const tokens: Tok[] = [];
  // Matches: key strings (followed by :), plain strings, numbers, keywords, everything else
  const re =
    /("(?:[^"\\]|\\.)*")\s*(?=:)|("(?:[^"\\]|\\.)*")|([-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false|null)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(pretty)) !== null) {
    if (m.index > last) tokens.push({ t: "other", v: pretty.slice(last, m.index) });
    if (m[1] !== undefined) {
      // key string — include the full match (which is just the string, lookahead consumed nothing)
      tokens.push({ t: "key", v: m[1] });
    } else if (m[2] !== undefined) {
      tokens.push({ t: "string", v: m[2] });
    } else if (m[3] !== undefined) {
      tokens.push({ t: "number", v: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ t: "keyword", v: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < pretty.length) tokens.push({ t: "other", v: pretty.slice(last) });

  const colors: Record<TokType, string> = {
    key:     "text-portal-gold",
    string:  "text-bone-white/80",
    number:  "text-cosmic-teal",
    keyword: "text-weathered-stone",
    other:   "text-weathered-stone/60",
  };

  return (
    <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-all">
      {tokens.map((tok, i) => (
        <span key={i} className={colors[tok.t]}>
          {tok.v}
        </span>
      ))}
    </pre>
  );
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownView({ raw }: { raw: string }) {
  const lines = raw.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("# "))
          return (
            <h1 key={i} className="font-display text-xl text-portal-gold mt-8 mb-2 first:mt-0">
              {line.slice(2)}
            </h1>
          );
        if (line.startsWith("## "))
          return (
            <h2 key={i} className="font-semibold text-base text-bone-white mt-6 mb-1.5">
              {line.slice(3)}
            </h2>
          );
        if (line.startsWith("### "))
          return (
            <h3 key={i} className="font-semibold text-sm text-aged-parchment mt-4 mb-1">
              {line.slice(4)}
            </h3>
          );
        if (line.trim() === "---")
          return <hr key={i} className="border-weathered-stone/20 my-4" />;
        if (line.trim() === "")
          return <div key={i} className="h-2" />;

        // Inline bold
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        return (
          <p key={i} className="text-bone-white/80">
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j} className="text-bone-white font-semibold">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                part
              )
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── File size formatter ──────────────────────────────────────────────────────

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Copy-to-clipboard button ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-[10px] uppercase tracking-widest text-weathered-stone/60 hover:text-portal-gold border border-weathered-stone/20 hover:border-portal-gold/40 px-2 py-0.5 rounded transition-colors shrink-0"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Thumbnail prompt detail view ─────────────────────────────────────────────

function ThumbnailDetailView({ thumb }: { thumb: ThumbnailPrompt }) {
  const templateName = THUMBNAIL_TEMPLATES.find((t) => t.num === thumb.template)?.name ?? "Unknown";
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
        <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone">
          Thumbnail · Generation {thumb.generation} · Template {thumb.template} ({templateName})
        </p>
      </div>
      <div className="flex-1 min-h-0 px-8 pb-8 overflow-y-auto space-y-6">
        {thumb.textOverlay && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest text-weathered-stone/50">
                Text Overlay
              </p>
              <CopyButton text={thumb.textOverlay} />
            </div>
            <p className="text-portal-gold font-display text-lg tracking-wide">
              {thumb.textOverlay}
            </p>
          </div>
        )}

        {thumb.kieCommand && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest text-weathered-stone/50">
                Generate Command
              </p>
              <CopyButton text={thumb.kieCommand} />
            </div>
            <p className="text-xs font-mono text-bone-white/70 break-all">{thumb.kieCommand}</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-widest text-weathered-stone/50">
              Nano Banana 2 JSON Prompt
            </p>
            {thumb.thumbnailJson != null && (
              <CopyButton text={JSON.stringify(thumb.thumbnailJson, null, 2)} />
            )}
          </div>
          {thumb.thumbnailJson != null ? (
            <JsonView raw={JSON.stringify(thumb.thumbnailJson)} />
          ) : (
            <p className="text-weathered-stone/40 text-xs">No JSON prompt parsed.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

// ── Media approval banner ─────────────────────────────────────────────────────

// ── Script approval banner ───────────────────────────────────────────────────
// Gate added 2026-08-12: pauses Phase 1 after script.md is written, before it's
// sent to ElevenLabs for paid TTS synthesis. No inline edit buffer here — unlike
// the JSON manifests below, script.md is markdown meant to be read and, if it
// needs changes, edited directly on disk (or re-run through the Script Agent)
// before approving, not patched through a text field.

function ScriptApprovalBanner({
  onApprove,
  onReject,
  isPending,
  error,
}: {
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <section className="mb-6">
      <div className="bg-amber-torchlight/10 border border-amber-torchlight/30 rounded-lg p-4">
        <p className="text-amber-torchlight text-[10px] font-medium uppercase tracking-widest mb-2">
          Script Review
        </p>
        <p className="text-bone-white/70 text-[11px] mb-3 leading-relaxed">
          Read the &ldquo;Script&rdquo; artifact (Phase 1) before approving. Once approved, it
          goes straight to ElevenLabs for paid voiceover synthesis — this is the last
          chance to catch a problem before that spend happens.
        </p>
        <div className="space-y-1.5">
          <button
            onClick={onApprove}
            disabled={isPending}
            className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {isPending ? "Sending to voiceover..." : "Approve & Generate Voiceover"}
          </button>
          <button
            onClick={onReject}
            disabled={isPending}
            className="w-full border border-deep-crimson/50 text-deep-crimson text-xs py-2 rounded hover:bg-deep-crimson/10 disabled:opacity-40 transition-colors"
          >
            Reject
          </button>
        </div>
        {error && <p className="text-deep-crimson text-[10px] mt-2">{error}</p>}
      </div>
    </section>
  );
}

function MediaApprovalBanner({
  pendingEdits,
  onApprove,
  onReject,
  isPending,
  error,
}: {
  pendingEdits: Record<string, string>;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const hasImageEdit = "scripts/image_manifest.json" in pendingEdits;
  const hasVideoEdit = "scripts/video_manifest.json" in pendingEdits;

  return (
    <section className="mb-6">
      <div className="bg-amber-torchlight/10 border border-amber-torchlight/30 rounded-lg p-4">
        <p className="text-amber-torchlight text-[10px] font-medium uppercase tracking-widest mb-2">
          Media Review
        </p>
        <p className="text-bone-white/70 text-[11px] mb-3 leading-relaxed">
          Review and optionally edit image and video prompts before sending to generation.
        </p>
        <div className="space-y-1 mb-3">
          {[
            { label: "Image Manifest", edited: hasImageEdit },
            { label: "Video Manifest", edited: hasVideoEdit },
          ].map(({ label, edited }) => (
            <div key={label} className="flex items-center gap-2 text-[11px]">
              <span className="text-portal-gold/70">✓</span>
              <span className="text-bone-white/70">{label}</span>
              {edited && (
                <span className="text-cosmic-teal text-[10px] font-medium">edited</span>
              )}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <button
            onClick={onApprove}
            disabled={isPending}
            className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {isPending ? "Sending to generation..." : "Approve & Generate"}
          </button>
          <button
            onClick={onReject}
            disabled={isPending}
            className="w-full border border-deep-crimson/50 text-deep-crimson text-xs py-2 rounded hover:bg-deep-crimson/10 disabled:opacity-40 transition-colors"
          >
            Reject
          </button>
        </div>
        {error && <p className="text-deep-crimson text-[10px] mt-2">{error}</p>}
      </div>
    </section>
  );
}

// ── Paused (Claude usage limit) banner ───────────────────────────────────────

function PausedBanner({
  pausedInfo,
  onResume,
  isPending,
  error,
}: {
  pausedInfo: PausedInfo;
  onResume: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const resumeDate = pausedInfo.retryAfter ? new Date(pausedInfo.retryAfter) : null;
  const resumeLabel =
    resumeDate && !isNaN(resumeDate.getTime())
      ? resumeDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "an unknown time";

  return (
    <section className="mb-6">
      <div className="bg-amber-torchlight/10 border border-amber-torchlight/30 rounded-lg p-4">
        <p className="text-amber-torchlight text-[10px] font-medium uppercase tracking-widest mb-2">
          Paused — Claude Usage Limit
        </p>
        <p className="text-bone-white/70 text-[11px] mb-3 leading-relaxed">
          Phase {pausedInfo.phase || "?"} hit Claude&apos;s usage limit and paused.
          Resumes around <span className="text-amber-torchlight">{resumeLabel}</span>,
          or click below to retry now.
        </p>
        <button
          onClick={onResume}
          disabled={isPending}
          className="w-full bg-amber-torchlight text-charcoal font-semibold text-xs py-2 rounded hover:bg-portal-gold disabled:opacity-40 transition-colors"
        >
          {isPending ? "Resuming..." : "Resume Now"}
        </button>
        {error && <p className="text-deep-crimson text-[10px] mt-2">{error}</p>}
      </div>
    </section>
  );
}

// ── Failed assets banner ──────────────────────────────────────────────────────

function FailedAssetsBanner({ failedAssets }: { failedAssets: FailedAsset[] }) {
  return (
    <section className="mb-6">
      <div className="bg-deep-crimson/10 border border-deep-crimson/30 rounded-lg p-4">
        <p className="text-deep-crimson text-[10px] font-medium uppercase tracking-widest mb-2">
          {failedAssets.length} Asset{failedAssets.length === 1 ? "" : "s"} Failed in Phase 2
        </p>
        <p className="text-bone-white/70 text-[11px] mb-3 leading-relaxed">
          Kie.ai returned no usable result for these — they were skipped. Generate them
          manually before rendering, or Phase 3&apos;s pre-render gate will block on them.
        </p>
        <div className="space-y-2">
          {failedAssets.map((a, i) => (
            <div key={i} className="text-[11px]">
              <span className="font-mono text-deep-crimson/80 uppercase">{a.type}</span>
              <span className="font-mono text-bone-white/70"> · {a.filename}</span>
              <p className="text-weathered-stone/50 text-[10px] mt-0.5">{a.reason}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Phase completion banner ───────────────────────────────────────────────────

function CompletionBanner({
  slug,
  outputs,
  youtubeUrl,
}: {
  slug: string;
  outputs: EpisodeOutputs;
  youtubeUrl?: string;
}) {
  const [url, setUrl] = useState(youtubeUrl ?? "");
  const [editing, setEditing] = useState(!youtubeUrl);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const phase1Done = outputs.research && outputs.script && outputs.voice;
  const phase2Done = outputs.timeline && outputs.images && outputs.videos && outputs.voiceover;
  const phase3Done = outputs.metadata;

  async function handleSave() {
    if (!url.trim()) return;
    setSaving(true);
    setSaveError(null);
    const result = await setYoutubeUrl(slug, url.trim());
    setSaving(false);
    if (result?.error) { setSaveError(result.error); return; }
    setEditing(false);
  }

  return (
    <section className="mb-6">
      <div className="bg-portal-gold/10 border border-portal-gold/30 rounded-lg p-4">
        <p className="text-portal-gold text-[10px] font-medium uppercase tracking-widest mb-3">
          Complete
        </p>
        {/* Phase checkmarks */}
        <div className="space-y-1.5 mb-4">
          {[
            { label: "Phase 1", done: phase1Done },
            { label: "Phase 2", done: phase2Done },
            { label: "Phase 3", done: phase3Done },
          ].map(({ label, done }) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <span className={done ? "text-portal-gold" : "text-weathered-stone/40"}>
                {done ? "✓" : "○"}
              </span>
              <span className={done ? "text-bone-white" : "text-weathered-stone/40"}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* YouTube URL */}
        {youtubeUrl && !editing ? (
          <div className="space-y-1.5">
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-cosmic-teal/20 border border-cosmic-teal/40 text-cosmic-teal text-xs py-1.5 rounded hover:bg-cosmic-teal/30 transition-colors"
            >
              Watch on YouTube
            </a>
            <button
              onClick={() => setEditing(true)}
              className="w-full text-weathered-stone/50 text-[10px] hover:text-weathered-stone transition-colors"
            >
              Edit link
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full bg-charcoal border border-weathered-stone/25 rounded px-2 py-1 text-[11px] text-bone-white placeholder-weathered-stone/40 outline-none focus:border-portal-gold"
            />
            <button
              onClick={handleSave}
              disabled={saving || !url.trim()}
              className="w-full bg-portal-gold/80 text-charcoal text-[11px] font-semibold py-1 rounded hover:bg-portal-gold disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving..." : "Save YouTube Link"}
            </button>
            {saveError && <p className="text-deep-crimson text-[10px]">{saveError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

type Props = {
  episode: Episode;
  outputs: EpisodeOutputs;
  fileGroups: FileGroup[];
  failedAssets: FailedAsset[];
  pausedInfo: PausedInfo | null;
  thumbnails: ThumbnailPrompt[];
};

export default function ArtifactPanel({ episode, outputs, fileGroups, failedAssets, pausedInfo, thumbnails }: Props) {
  const { slug, status, phase, youtubeUrl } = episode;
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState<keyof EpisodeOutputs | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Thumbnail generator state
  const [selectedThumb, setSelectedThumb] = useState<number | null>(null);
  const [thumbTemplate, setThumbTemplate] = useState(1);
  const [thumbTitleOverride, setThumbTitleOverride] = useState("");
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [isGeneratingThumb, startThumbTransition] = useTransition();

  // Edit state for media approval
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  // Ref so artifact-switch handler can read latest values without stale closure
  const editRef = useRef({ editMode: false, editContent: "", selectedPath: "" });
  editRef.current = { editMode, editContent, selectedPath: ARTIFACTS.find(a => a.key === selectedKey)?.path ?? "" };

  // Auto-select first available artifact on mount
  useEffect(() => {
    const first = ARTIFACTS.find((a) => outputs[a.key]);
    if (first) setSelectedKey(first.key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh while running or awaiting script/media approval (prompts may still be writing)
  useEffect(() => {
    if (status !== "running" && status !== "awaiting_script_approval" && status !== "awaiting_media_approval") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [status, router]);

  // Fetch artifact content when selection changes
  const selected = ARTIFACTS.find((a) => a.key === selectedKey) ?? null;
  const selectedThumbData = thumbnails.find((t) => t.generation === selectedThumb) ?? null;

  useEffect(() => {
    if (!selected || selected.type === "audio") {
      setContent(null);
      return;
    }
    setLoadingContent(true);
    setContent(null);
    setFetchError(null);
    fetch(`/api/episodes/${slug}/artifact?path=${encodeURIComponent(selected.path)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        setContent(text);
        setLoadingContent(false);
      })
      .catch((e) => {
        setFetchError(String(e));
        setLoadingContent(false);
      });
  }, [selected, slug]);

  // Phase action handler
  function runAction(action: () => Promise<{ error?: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setActionError(result.error);
      else router.refresh();
    });
  }

  // Save current edit to pendingEdits and exit edit mode
  function commitEdit() {
    const { editMode: em, editContent: ec, selectedPath: sp } = editRef.current;
    if (em && sp && ec !== (content ?? "")) {
      setPendingEdits((prev) => ({ ...prev, [sp]: ec }));
    }
    setEditMode(false);
  }

  // Switch artifact — commit any in-progress edit first
  function selectArtifact(key: keyof EpisodeOutputs) {
    commitEdit();
    setSelectedThumb(null);
    setSelectedFile(null);
    setSelectedKey(key);
  }

  // Switch to a generated thumbnail prompt
  function selectThumb(generation: number) {
    commitEdit();
    setSelectedKey(null);
    setSelectedFile(null);
    setSelectedThumb(generation);
  }

  // Switch to a previewable file from the Files list (e.g. a thumbnail image)
  function selectFile(relPath: string) {
    commitEdit();
    setSelectedKey(null);
    setSelectedThumb(null);
    setSelectedFile(relPath);
  }

  // Generate a new thumbnail prompt via the Claude Bridge
  function handleGenerateThumbnail() {
    setThumbError(null);
    startThumbTransition(async () => {
      const result = await generateThumbnailPrompt(slug, thumbTemplate, thumbTitleOverride);
      if (result?.error) {
        setThumbError(result.error);
        return;
      }
      setThumbTitleOverride("");
      router.refresh();
    });
  }

  // Enter edit mode for the current JSON artifact
  function enterEditMode() {
    const initial = pendingEdits[selected!.path] ?? content ?? "";
    setEditContent(initial);
    setEditMode(true);
  }

  // Approve: flush any open edit, then call action
  function handleApprove() {
    const { editMode: em, editContent: ec, selectedPath: sp } = editRef.current;
    const latestEdits = { ...pendingEdits };
    if (em && sp && ec !== (content ?? "")) latestEdits[sp] = ec;
    setEditMode(false);
    runAction(() =>
      approveMediaPrompts(slug, {
        imageManifest: latestEdits["scripts/image_manifest.json"],
        videoManifest: latestEdits["scripts/video_manifest.json"],
      })
    );
  }

  // Determine available actions
  const isRunning = status === "running";
  const isAwaitingScriptApproval = status === "awaiting_script_approval";
  const isAwaitingMediaApproval = status === "awaiting_media_approval";
  const isAwaitingApproval = isAwaitingScriptApproval || isAwaitingMediaApproval;
  const isPaused = status === "paused_until";
  const canPhase1    = phase === null && !isRunning && !isAwaitingApproval && !isPaused;
  const canPhase2    = phase === 1    && !isRunning && !isAwaitingApproval && !isPaused;
  const canPhase3    = phase === 2    && !isRunning && !isAwaitingApproval && !isPaused;
  const canMarkDone  = phase === 3    && !isRunning && !isAwaitingApproval && !isPaused && status !== "done" && status !== "rejected";
  const canReject    = !isRunning && !isAwaitingApproval && !isPaused && status !== "done" && status !== "rejected";
  const hasActions   = canPhase1 || canPhase2 || canPhase3 || canMarkDone || canReject;

  // Whether the selected artifact is editable in media review mode
  const canEditArtifact =
    isAwaitingMediaApproval &&
    selected?.type === "json" &&
    (selected.path === "scripts/image_manifest.json" || selected.path === "scripts/video_manifest.json");

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left column ─────────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-weathered-stone/15 overflow-y-auto p-6 space-y-8">
        {/* Paused banner — Claude usage limit hit, manual resume */}
        {isPaused && pausedInfo && (
          <PausedBanner
            pausedInfo={pausedInfo}
            onResume={() => runAction(() => resumeFromPause(slug))}
            isPending={isPending}
            error={actionError}
          />
        )}

        {/* Failed assets banner — shown regardless of status */}
        {failedAssets.length > 0 && <FailedAssetsBanner failedAssets={failedAssets} />}

        {/* Script approval banner — read scripts/script.md (the "Script" artifact,
            visible in the Phase 1 column) before approving. Blocks ElevenLabs spend. */}
        {isAwaitingScriptApproval && (
          <ScriptApprovalBanner
            onApprove={() => runAction(() => approveScript(slug))}
            onReject={() => runAction(() => rejectEpisode(slug))}
            isPending={isPending}
            error={actionError}
          />
        )}

        {/* Media approval banner */}
        {isAwaitingMediaApproval && (
          <MediaApprovalBanner
            pendingEdits={pendingEdits}
            onApprove={handleApprove}
            onReject={() => runAction(() => rejectEpisode(slug))}
            isPending={isPending}
            error={actionError}
          />
        )}

        {/* Completion banner */}
        {status === "done" && (
          <CompletionBanner slug={slug} outputs={outputs} youtubeUrl={youtubeUrl} />
        )}

        {/* Artifacts by phase */}
        <section>
          <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-3">
            Artifacts
          </p>
          <div className="space-y-5">
            {([1, 2, 3] as const).map((p) => (
              <div key={p}>
                <p className="text-[10px] uppercase tracking-widest text-weathered-stone/40 mb-1.5">
                  Phase {p}
                </p>
                <div className="space-y-0.5">
                  {ARTIFACTS.filter((a) => a.phase === p).map((a) => {
                    const available = outputs[a.key];
                    const active = selectedKey === a.key;
                    return (
                      <button
                        key={a.key}
                        disabled={!available}
                        onClick={() => available && selectArtifact(a.key)}
                        className={[
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors",
                          active
                            ? "bg-portal-gold/15 text-portal-gold"
                            : available
                            ? "text-bone-white hover:bg-deep-teal/60 hover:text-portal-gold cursor-pointer"
                            : "text-weathered-stone/30 cursor-default",
                        ].join(" ")}
                      >
                        <span className={`text-[10px] leading-none ${available ? (active ? "text-portal-gold" : "text-portal-gold/70") : "text-weathered-stone/20"}`}>
                          {available ? "✓" : "○"}
                        </span>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Thumbnails */}
        <section>
          <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-3">
            Thumbnails
          </p>
          {thumbnails.length > 0 && (
            <div className="space-y-0.5 mb-3">
              {thumbnails.map((t) => {
                const active = selectedThumb === t.generation;
                return (
                  <button
                    key={t.generation}
                    onClick={() => selectThumb(t.generation)}
                    className={[
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors",
                      active
                        ? "bg-portal-gold/15 text-portal-gold"
                        : "text-bone-white hover:bg-deep-teal/60 hover:text-portal-gold cursor-pointer",
                    ].join(" ")}
                  >
                    <span className={`text-[10px] leading-none ${active ? "text-portal-gold" : "text-portal-gold/70"}`}>
                      ✓
                    </span>
                    Gen {t.generation} · Template {t.template}
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-1.5">
            <select
              value={thumbTemplate}
              onChange={(e) => setThumbTemplate(parseInt(e.target.value, 10))}
              className="w-full bg-charcoal border border-weathered-stone/25 rounded px-2 py-1 text-[11px] text-bone-white outline-none focus:border-portal-gold"
            >
              {THUMBNAIL_TEMPLATES.map((tpl) => (
                <option key={tpl.num} value={tpl.num}>
                  {tpl.num}. {tpl.name}
                </option>
              ))}
            </select>
            <p className="text-weathered-stone/40 text-[10px] leading-snug">
              {THUMBNAIL_TEMPLATES.find((t) => t.num === thumbTemplate)?.desc}
            </p>
            <input
              type="text"
              value={thumbTitleOverride}
              onChange={(e) => setThumbTitleOverride(e.target.value)}
              placeholder={episode.topic}
              className="w-full bg-charcoal border border-weathered-stone/25 rounded px-2 py-1 text-[11px] text-bone-white placeholder-weathered-stone/40 outline-none focus:border-portal-gold"
            />
            <button
              onClick={handleGenerateThumbnail}
              disabled={isGeneratingThumb}
              className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
            >
              {isGeneratingThumb ? "Generating..." : "Generate Thumbnail"}
            </button>
            {thumbError && <p className="text-deep-crimson text-[10px]">{thumbError}</p>}
          </div>
        </section>

        {/* Actions */}
        {(hasActions || isRunning) && (
          <section>
            <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-3">
              Actions
            </p>
            {isRunning ? (
              <div className="flex items-center gap-2 text-cosmic-teal text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-cosmic-teal animate-pulse" />
                Running...
              </div>
            ) : (
              <div className="space-y-2">
                {canPhase1 && (
                  <button
                    onClick={() => runAction(() => startPhase1ForEpisode(slug))}
                    disabled={isPending}
                    className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "Triggering..." : "Start Phase 1"}
                  </button>
                )}
                {canPhase2 && (
                  <button
                    onClick={() => runAction(() => startPhase2(slug))}
                    disabled={isPending}
                    className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "Triggering..." : "Start Phase 2"}
                  </button>
                )}
                {canPhase3 && (
                  <button
                    onClick={() => runAction(() => startPhase3(slug))}
                    disabled={isPending}
                    className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "Triggering..." : "Start Phase 3"}
                  </button>
                )}
                {canMarkDone && (
                  <button
                    onClick={() => runAction(() => markEpisodeDone(slug))}
                    disabled={isPending}
                    className="w-full bg-portal-gold text-charcoal font-semibold text-xs py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "Saving..." : "Mark as Done"}
                  </button>
                )}
                {canReject && (
                  <button
                    onClick={() => runAction(() => rejectEpisode(slug))}
                    disabled={isPending}
                    className="w-full border border-deep-crimson/50 text-deep-crimson text-xs py-2 rounded hover:bg-deep-crimson/10 disabled:opacity-40 transition-colors"
                  >
                    Reject
                  </button>
                )}
              </div>
            )}
            {actionError && (
              <p className="text-deep-crimson text-xs mt-2">{actionError}</p>
            )}
          </section>
        )}

        {/* Files */}
        {fileGroups.length > 0 && (
          <section>
            <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-3">
              Files
            </p>
            <div className="space-y-4">
              {fileGroups.map((group) => (
                <div key={group.dir}>
                  <p className="text-[10px] font-mono text-weathered-stone/50 mb-1">
                    {group.dir}/
                  </p>
                  <div className="space-y-0.5">
                    {group.files.map((file) => {
                      const relPath = `${group.dir}/${file.name}`;
                      const isImage = IMAGE_EXTENSIONS.has(file.ext);
                      const active = selectedFile === relPath;

                      if (!isImage) {
                        return (
                          <div key={file.name} className="flex justify-between gap-2 text-[11px] px-1 py-0.5 -mx-1">
                            <span className="font-mono text-bone-white/70 truncate">{file.name}</span>
                            <span className="text-weathered-stone/50 tabular-nums shrink-0">
                              {fmt(file.size)}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={file.name}
                          onClick={() => selectFile(relPath)}
                          className={[
                            "w-full flex justify-between gap-2 text-[11px] px-1 py-0.5 -mx-1 rounded text-left transition-colors",
                            active
                              ? "bg-portal-gold/15 text-portal-gold"
                              : "hover:bg-deep-teal/60 hover:text-portal-gold cursor-pointer",
                          ].join(" ")}
                        >
                          <span className={`font-mono truncate ${active ? "text-portal-gold" : "text-bone-white/70"}`}>
                            {file.name}
                          </span>
                          <span className="text-weathered-stone/50 tabular-nums shrink-0">
                            {fmt(file.size)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Right column: preview / edit ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-abyss">
        {selectedThumbData ? (
          <ThumbnailDetailView thumb={selectedThumbData} />
        ) : selectedFile ? (
          <div className="p-8">
            <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-4">
              {selectedFile}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/episodes/${slug}/artifact?path=${encodeURIComponent(selectedFile)}`}
              alt={selectedFile}
              className="max-w-full rounded border border-weathered-stone/15"
            />
          </div>
        ) : !selected ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-weathered-stone/40 text-sm">Select an artifact to preview</p>
          </div>
        ) : selected.type === "audio" ? (
          <div className="p-8 space-y-4">
            <p className="text-xs font-medium uppercase tracking-widest text-weathered-stone">
              {selected.label}
            </p>
            <audio
              controls
              src={`/api/episodes/${slug}/artifact?path=${encodeURIComponent(selected.path)}`}
              className="w-full max-w-lg"
            />
          </div>
        ) : loadingContent ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-weathered-stone/50 text-sm">Loading...</p>
          </div>
        ) : fetchError ? (
          <div className="p-8">
            <p className="text-deep-crimson text-sm">{fetchError}</p>
          </div>
        ) : content ? (
          <div className="flex flex-col h-full">
            {/* Header row */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
              <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone">
                {selected.label}
                {pendingEdits[selected.path] && (
                  <span className="ml-2 text-cosmic-teal normal-case">(edited)</span>
                )}
              </p>
              {canEditArtifact && !editMode && (
                <button
                  onClick={enterEditMode}
                  className="text-[10px] uppercase tracking-widest text-weathered-stone/60 hover:text-portal-gold border border-weathered-stone/20 hover:border-portal-gold/40 px-2 py-0.5 rounded transition-colors"
                >
                  Edit
                </button>
              )}
              {editMode && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={commitEdit}
                    className="text-[10px] uppercase tracking-widest text-cosmic-teal border border-cosmic-teal/40 px-2 py-0.5 rounded hover:bg-cosmic-teal/10 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="text-[10px] uppercase tracking-widest text-weathered-stone/50 hover:text-weathered-stone px-2 py-0.5 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 min-h-0 px-8 pb-8 overflow-y-auto">
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                  className="w-full h-full min-h-[60vh] bg-charcoal border border-weathered-stone/20 rounded p-4 text-xs font-mono text-bone-white/90 leading-relaxed resize-none outline-none focus:border-portal-gold/50 transition-colors"
                />
              ) : selected.type === "json" ? (
                <JsonView raw={pendingEdits[selected.path] ?? content} />
              ) : (
                <MarkdownView raw={content} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
