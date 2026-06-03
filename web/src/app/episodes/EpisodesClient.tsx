"use client";

import { useState } from "react";
import Link from "next/link";
import StatusSelect from "@/components/StatusSelect";
import type { Episode, EpisodeStatus } from "@/lib/episodes";

type Filter = EpisodeStatus | "all";

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  idle:            "Idle",
  running:         "Running",
  awaiting_review: "Awaiting Review",
  done:            "Done",
  error:           "Error",
  rejected:        "Rejected",
};

const FILTERS: Filter[] = ["all", "idle", "running", "awaiting_review", "done", "error", "rejected"];

export default function EpisodesClient({ episodes }: { episodes: Episode[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = filter === "all"
    ? episodes
    : episodes.filter((ep) => ep.status === filter);

  const counts = FILTERS.reduce<Record<Filter, number>>((acc, f) => {
    acc[f] = f === "all" ? episodes.length : episodes.filter((ep) => ep.status === f).length;
    return acc;
  }, {} as Record<Filter, number>);

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              "px-3 py-1 rounded text-xs font-medium transition-colors",
              filter === f
                ? "bg-portal-gold text-charcoal"
                : "text-weathered-stone border border-weathered-stone/25 hover:text-bone-white",
            ].join(" ")}
          >
            {f === "all" ? "All" : STATUS_LABELS[f as EpisodeStatus]}
            <span className="ml-1.5 opacity-60">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="border border-weathered-stone/20 rounded-lg p-12 text-center">
          <p className="text-weathered-stone text-sm">No episodes match this filter.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {visible.map((ep) => (
            <Link
              key={ep.slug}
              href={`/episodes/${ep.slug}`}
              className="block bg-deep-teal border border-weathered-stone/15 rounded-lg px-6 py-4 hover:border-weathered-stone/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-bone-white font-semibold capitalize truncate group-hover:text-portal-gold transition-colors">
                    {ep.topic}
                  </h2>
                  <p className="text-weathered-stone text-xs mt-0.5 font-mono">{ep.slug}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {ep.youtubeUrl && ep.status === "done" && (
                    <a
                      href={ep.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-cosmic-teal border border-cosmic-teal/40 px-2 py-0.5 rounded hover:bg-cosmic-teal/10 transition-colors shrink-0"
                    >
                      Watch
                    </a>
                  )}
                  {ep.phase && (
                    <span className="text-weathered-stone text-xs">Phase {ep.phase}</span>
                  )}
                  <StatusSelect slug={ep.slug} status={ep.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
