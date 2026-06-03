"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startPhase1ForEpisode, startPhase2, startPhase3, rejectEpisode, setYoutubeUrl } from "@/app/actions/episodes";
import type { Episode, EpisodeOutputs, FileGroup } from "@/lib/episodes";

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

// ── Main component ───────────────────────────────────────────────────────────

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
};

export default function ArtifactPanel({ episode, outputs, fileGroups }: Props) {
  const { slug, status, phase, youtubeUrl } = episode;
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState<keyof EpisodeOutputs | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-select first available artifact on mount
  useEffect(() => {
    const first = ARTIFACTS.find((a) => outputs[a.key]);
    if (first) setSelectedKey(first.key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh while running
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [status, router]);

  // Fetch artifact content when selection changes
  const selected = ARTIFACTS.find((a) => a.key === selectedKey) ?? null;

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

  // Determine available actions
  const isRunning = status === "running";
  const canPhase1 = phase === null && !isRunning;
  const canPhase2 = phase === 1 && !isRunning;
  const canPhase3 = phase === 2 && !isRunning;
  const canReject = !isRunning && status !== "done" && status !== "rejected";
  const hasActions = canPhase1 || canPhase2 || canPhase3 || canReject;

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left column ─────────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-weathered-stone/15 overflow-y-auto p-6 space-y-8">
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
                        onClick={() => available && setSelectedKey(a.key)}
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
                    {group.files.map((file) => (
                      <div key={file.name} className="flex justify-between gap-2 text-[11px]">
                        <span className="font-mono text-bone-white/70 truncate">{file.name}</span>
                        <span className="text-weathered-stone/50 tabular-nums shrink-0">
                          {fmt(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Right column: preview ────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-abyss">
        {!selected ? (
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
          <div className="p-8">
            <p className="text-[10px] font-medium uppercase tracking-widest text-weathered-stone mb-4">
              {selected.label}
            </p>
            {selected.type === "json" ? (
              <JsonView raw={content} />
            ) : (
              <MarkdownView raw={content} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
