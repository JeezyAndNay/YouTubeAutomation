"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startPhase1ForEpisode, startPhase2, startPhase3, rejectEpisode } from "@/app/actions/episodes";
import type { Episode, EpisodeOutputs } from "@/lib/episodes";

type Props = {
  episode: Episode;
  outputs: EpisodeOutputs;
};

export default function EpisodeActions({ episode, outputs }: Props) {
  const { slug, status, phase } = episode;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-refresh every 5s while running so the server re-renders with fresh data
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [status, router]);

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  if (status === "running") {
    return (
      <div className="flex items-center gap-3 text-cosmic-teal text-sm">
        <span className="inline-block w-2 h-2 rounded-full bg-cosmic-teal animate-pulse" />
        Running — auto-refreshing every 5s
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <p className="text-weathered-stone text-sm">
        Episode rejected. Start a new episode or update the topic.
      </p>
    );
  }

  // Determine which phase button to show (status is not "running" or "rejected" here)
  const canStartPhase1 = phase === null;
  const canStartPhase2 = phase === 1;
  const canStartPhase3 = phase === 2;
  const canReject = status !== "done";

  if (!canStartPhase1 && !canStartPhase2 && !canStartPhase3 && !canReject) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 flex-wrap">
        {canStartPhase1 && (
          <button
            onClick={() => run(() => startPhase1ForEpisode(slug))}
            disabled={isPending}
            className="bg-portal-gold text-charcoal font-semibold text-sm px-5 py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {isPending ? "Triggering..." : "Start Phase 1"}
          </button>
        )}
        {canStartPhase2 && (
          <button
            onClick={() => run(() => startPhase2(slug))}
            disabled={isPending}
            className="bg-portal-gold text-charcoal font-semibold text-sm px-5 py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {isPending ? "Triggering..." : "Start Phase 2"}
          </button>
        )}
        {canStartPhase3 && (
          <button
            onClick={() => run(() => startPhase3(slug))}
            disabled={isPending}
            className="bg-portal-gold text-charcoal font-semibold text-sm px-5 py-2 rounded hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {isPending ? "Triggering..." : "Start Phase 3"}
          </button>
        )}
        {canReject && (
          <button
            onClick={() => run(() => rejectEpisode(slug))}
            disabled={isPending}
            className="border border-deep-crimson/60 text-deep-crimson text-sm px-5 py-2 rounded hover:bg-deep-crimson/10 disabled:opacity-40 transition-colors"
          >
            Reject
          </button>
        )}
      </div>
      {error && <p className="text-deep-crimson text-xs font-medium">{error}</p>}
    </div>
  );
}
