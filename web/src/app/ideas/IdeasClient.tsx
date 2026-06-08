"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Idea, IdeaStatus } from "@/lib/sheets";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = IdeaStatus | "all";

// ── Status display ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<IdeaStatus, string> = {
  "New":         "New",
  "In Progress": "In Progress",
  "Complete":    "Complete",
};

const STATUS_COLORS: Record<IdeaStatus, string> = {
  "New":         "text-bone-white  bg-weathered-stone/30",
  "In Progress": "text-cosmic-teal bg-cosmic-teal/10",
  "Complete":    "text-portal-gold bg-portal-gold/20",
};

const ALL_STATUSES: IdeaStatus[] = ["New", "In Progress", "Complete"];

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchIdeas(): Promise<Idea[]> {
  const res = await fetch("/api/ideas");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load ideas");
  }
  return res.json();
}

async function patchIdea(rowNumber: number, patch: Partial<Idea>) {
  const res = await fetch(`/api/ideas/${rowNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update idea");
}

async function triggerGenerate(params: { quantity?: number; keyword?: string }) {
  const res = await fetch("/api/ideas/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to trigger idea generation");
}

async function deleteIdeaRow(rowNumber: number) {
  const res = await fetch(`/api/ideas/${rowNumber}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to delete idea");
  }
}

async function promoteToEpisode(idea: Idea): Promise<string> {
  const res = await fetch("/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: idea.topic, rowNumber: idea.rowNumber }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const { slug } = await res.json();
  await patchIdea(idea.rowNumber, { status: "In Progress" });
  return slug as string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function IdeasClient() {
  const qc = useQueryClient();
  const router = useRouter();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [editingRow, setEditingRow]     = useState<number | null>(null);
  const [editingField, setEditingField] = useState<keyof Idea | null>(null);
  const [editValue, setEditValue]       = useState("");
  const [genQuantity, setGenQuantity]   = useState(10);
  const [genKeyword, setGenKeyword]     = useState("");
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);

  const { data: ideas, isLoading, error } = useQuery({
    queryKey: ["ideas"],
    queryFn: fetchIdeas,
  });

  const updateMutation = useMutation({
    mutationFn: ({ rowNumber, patch }: { rowNumber: number; patch: Partial<Idea> }) =>
      patchIdea(rowNumber, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ideas"] }),
  });

  const generateMutation = useMutation({
    mutationFn: () => triggerGenerate({
      quantity: genQuantity !== 10 ? genQuantity : undefined,
      keyword:  genKeyword.trim() || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowNumber: number) => deleteIdeaRow(rowNumber),
    onSuccess: () => {
      setConfirmDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["ideas"] });
    },
  });

  const [promoteError, setPromoteError] = useState<string | null>(null);

  const promoteMutation = useMutation({
    mutationFn: (idea: Idea) => promoteToEpisode(idea),
    onSuccess: (slug: string) => {
      qc.invalidateQueries({ queryKey: ["ideas"] });
      router.push(`/episodes/${slug}`);
    },
    onError: (err: Error) => setPromoteError(err.message),
  });

  // ── Filter & search
  const visible = (ideas ?? []).filter((idea) => {
    const matchStatus = filter === "all" || idea.status === filter;
    const matchSearch =
      search === "" ||
      idea.topic.toLowerCase().includes(search.toLowerCase()) ||
      idea.angle.toLowerCase().includes(search.toLowerCase()) ||
      idea.notes.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  // ── Inline edit handlers
  function startEdit(idea: Idea, field: keyof Idea) {
    setEditingRow(idea.rowNumber);
    setEditingField(field);
    setEditValue(String(idea[field] ?? ""));
  }

  function commitEdit(idea: Idea) {
    if (editingField && editValue !== String(idea[editingField] ?? "")) {
      updateMutation.mutate({
        rowNumber: idea.rowNumber,
        patch: { [editingField]: editValue } as Partial<Idea>,
      });
    }
    setEditingRow(null);
    setEditingField(null);
  }

  function changeStatus(idea: Idea, status: IdeaStatus) {
    updateMutation.mutate({ rowNumber: idea.rowNumber, patch: { status } });
  }

  // ── Render
  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-xl tracking-[0.12em] uppercase text-bone-white">
            Idea Catalog
          </h1>
          <p className="text-weathered-stone text-sm mt-1">
            Google Sheets · {ideas ? `${ideas.length} ideas` : "loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Quantity input */}
          <input
            type="number"
            min={1}
            max={50}
            value={genQuantity}
            onChange={(e) => setGenQuantity(Math.max(1, parseInt(e.target.value, 10) || 10))}
            disabled={generateMutation.isPending}
            className="w-16 bg-deep-teal border border-weathered-stone/25 rounded px-2 py-2 text-sm text-bone-white text-center outline-none focus:border-portal-gold disabled:opacity-40"
            title="Number of ideas"
          />
          {/* Keyword input */}
          <input
            type="text"
            placeholder="topic filter…"
            value={genKeyword}
            onChange={(e) => setGenKeyword(e.target.value)}
            disabled={generateMutation.isPending}
            className="w-36 bg-deep-teal border border-weathered-stone/25 rounded px-3 py-2 text-sm text-bone-white placeholder-weathered-stone/40 outline-none focus:border-portal-gold disabled:opacity-40"
            title="Optional topic/keyword filter"
          />
          {/* Generate button */}
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="bg-portal-gold text-charcoal font-semibold text-sm px-5 py-2.5 rounded hover:bg-amber-torchlight disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {generateMutation.isPending ? "Generating…" : "Generate Ideas"}
          </button>
        </div>
      </div>

      {/* Auth notice */}
      {error && (
        <div className="mb-6 border border-deep-crimson/40 bg-deep-crimson/10 rounded-lg p-4">
          <p className="text-bone-white text-sm font-medium">Google Sheets not connected</p>
          <p className="text-weathered-stone text-xs mt-1">
            Run <code className="text-aged-parchment bg-charcoal px-1 rounded">node scripts/google-auth.mjs</code> then restart the dev server.
          </p>
          <p className="text-weathered-stone/60 text-xs mt-1">{String(error)}</p>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search topics, angles, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-deep-teal border border-weathered-stone/25 rounded px-3 py-1.5 text-sm text-bone-white placeholder-weathered-stone/50 outline-none focus:border-portal-gold"
        />
        <div className="flex gap-1.5">
          {(["all", ...ALL_STATUSES] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={[
                "px-3 py-1 rounded text-xs font-medium capitalize transition-colors",
                filter === s
                  ? "bg-portal-gold text-charcoal"
                  : "text-weathered-stone border border-weathered-stone/25 hover:text-bone-white",
              ].join(" ")}
            >
              {s === "all" ? "All" : STATUS_LABELS[s as IdeaStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* Promote error */}
      {promoteError && (
        <div className="mb-4 border border-deep-crimson/40 bg-deep-crimson/10 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-bone-white text-sm">Promote failed: {promoteError}</p>
          <button onClick={() => setPromoteError(null)} className="text-weathered-stone hover:text-bone-white text-xs shrink-0">Dismiss</button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="py-12 text-center text-weathered-stone text-sm">Loading…</div>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <>
          {visible.length === 0 ? (
            <div className="border border-weathered-stone/20 rounded-lg p-12 text-center">
              <p className="text-weathered-stone text-sm">No ideas match the current filter.</p>
            </div>
          ) : (
            <div className="border border-weathered-stone/15 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-charcoal text-weathered-stone text-xs uppercase tracking-widest">
                    <th className="px-4 py-3 text-left font-normal">Topic</th>
                    <th className="px-4 py-3 text-left font-normal">Angle</th>
                    <th className="px-4 py-3 text-left font-normal">Notes</th>
                    <th className="px-4 py-3 text-left font-normal">Status</th>
                    <th className="px-4 py-3 text-left font-normal">Added</th>
                    <th className="px-4 py-3 text-left font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((idea, idx) => {
                    const isEditing = editingRow === idea.rowNumber;
                    const rowBg = idx % 2 === 0 ? "bg-deep-teal" : "bg-abyss";

                    return (
                      <tr key={idea.rowNumber} className={`${rowBg} border-t border-weathered-stone/10 group`}>
                        {/* Topic */}
                        <td className="px-4 py-3 max-w-[220px]">
                          {isEditing && editingField === "topic" ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(idea)}
                              onKeyDown={(e) => e.key === "Enter" && commitEdit(idea)}
                              className="w-full bg-charcoal border border-portal-gold rounded px-2 py-0.5 text-bone-white outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startEdit(idea, "topic")}
                              className="text-bone-white font-medium cursor-text hover:text-portal-gold transition-colors block truncate"
                              title={idea.topic}
                            >
                              {idea.topic || <span className="text-weathered-stone italic">—</span>}
                            </span>
                          )}
                        </td>

                        {/* Angle */}
                        <td className="px-4 py-3 max-w-[200px]">
                          {isEditing && editingField === "angle" ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(idea)}
                              onKeyDown={(e) => e.key === "Enter" && commitEdit(idea)}
                              className="w-full bg-charcoal border border-portal-gold rounded px-2 py-0.5 text-bone-white outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startEdit(idea, "angle")}
                              className="text-aged-parchment cursor-text hover:text-bone-white transition-colors block truncate text-xs"
                              title={idea.angle}
                            >
                              {idea.angle || <span className="text-weathered-stone/40 italic">—</span>}
                            </span>
                          )}
                        </td>

                        {/* Notes */}
                        <td className="px-4 py-3 max-w-[220px]">
                          {isEditing && editingField === "notes" ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(idea)}
                              onKeyDown={(e) => e.key === "Enter" && commitEdit(idea)}
                              className="w-full bg-charcoal border border-portal-gold rounded px-2 py-0.5 text-bone-white outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startEdit(idea, "notes")}
                              className="text-weathered-stone cursor-text hover:text-bone-white transition-colors block truncate text-xs"
                              title={idea.notes}
                            >
                              {idea.notes || <span className="text-weathered-stone/30 italic">—</span>}
                            </span>
                          )}
                        </td>

                        {/* Status dropdown */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <select
                            value={idea.status}
                            onChange={(e) => changeStatus(idea, e.target.value as IdeaStatus)}
                            className={[
                              "text-[11px] font-medium px-2 py-0.5 rounded uppercase tracking-wide border-0 outline-none cursor-pointer",
                              STATUS_COLORS[idea.status],
                            ].join(" ")}
                          >
                            {ALL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-charcoal text-bone-white normal-case">
                                {STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3 text-weathered-stone text-xs whitespace-nowrap">
                          {idea.dateAdded || "—"}
                        </td>

                        {/* Promote + Delete buttons */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => { setPromoteError(null); promoteMutation.mutate(idea); }}
                              disabled={promoteMutation.isPending || !idea.topic}
                              className="text-xs bg-portal-gold/15 border border-portal-gold/40 text-portal-gold px-3 py-1 rounded hover:bg-portal-gold hover:text-charcoal disabled:opacity-30 transition-colors"
                            >
                              Promote
                            </button>
                            {idea.status !== "Complete" && (
                              confirmDeleteRow === idea.rowNumber ? (
                                <span className="flex items-center gap-1">
                                  <span className="text-weathered-stone text-xs">Delete?</span>
                                  <button
                                    onClick={() => deleteMutation.mutate(idea.rowNumber)}
                                    disabled={deleteMutation.isPending}
                                    className="text-xs bg-deep-crimson/20 border border-deep-crimson/50 text-deep-crimson px-2 py-1 rounded hover:bg-deep-crimson/40 disabled:opacity-30 transition-colors"
                                  >
                                    {deleteMutation.isPending ? "…" : "Yes"}
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteRow(null)}
                                    disabled={deleteMutation.isPending}
                                    className="text-xs text-weathered-stone hover:text-bone-white px-2 py-1 transition-colors"
                                  >
                                    No
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteRow(idea.rowNumber)}
                                  className="text-xs text-weathered-stone/50 hover:text-deep-crimson px-2 py-1 rounded transition-colors"
                                  title="Delete idea"
                                >
                                  ✕
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
