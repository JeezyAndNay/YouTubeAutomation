"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "running" | "awaiting_review" | "awaiting_media_approval" | "ready_for_phase3" | "done" | "error" | "rejected" | "paused_until";

const styles: Record<Status, string> = {
  idle:                    "text-weathered-stone bg-deep-teal",
  running:                 "text-cosmic-teal    bg-cosmic-teal/10",
  awaiting_review:         "text-portal-gold    bg-portal-gold/10",
  awaiting_media_approval: "text-amber-torchlight bg-amber-torchlight/10",
  ready_for_phase3:        "text-celestial-blue bg-celestial-blue/15",
  done:                    "text-portal-gold    bg-portal-gold/15",
  error:                   "text-bone-white     bg-deep-crimson/70",
  rejected:                "text-bone-white     bg-deep-crimson/50",
  paused_until:            "text-amber-torchlight bg-amber-torchlight/20",
};

const labels: Record<Status, string> = {
  idle:                    "Idle",
  running:                 "Running",
  awaiting_review:         "Awaiting Review",
  awaiting_media_approval: "Media Review",
  ready_for_phase3:        "Ready for Phase 3",
  done:                    "Done",
  error:                   "Error",
  rejected:                "Rejected",
  paused_until:            "Paused",
};

const ALL: Status[] = ["idle", "running", "awaiting_review", "awaiting_media_approval", "ready_for_phase3", "done", "error", "rejected", "paused_until"];

export default function StatusSelect({ slug, status }: { slug: string; status: Status }) {
  const router = useRouter();
  const [current, setCurrent] = useState<Status>(status);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const next = e.target.value as Status;
    setCurrent(next);
    startTransition(async () => {
      await fetch(`/api/episodes/${slug}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    });
  }

  return (
    <span
      className="relative inline-block"
      onClick={(e) => e.preventDefault()}
    >
      <select
        value={current}
        onChange={handleChange}
        disabled={isPending}
        className={[
          "appearance-none cursor-pointer px-2 py-0.5 rounded text-[11px] font-medium tracking-wide uppercase",
          "border-0 outline-none focus:ring-1 focus:ring-portal-gold/50",
          "disabled:opacity-60",
          styles[current],
        ].join(" ")}
      >
        {ALL.map((s) => (
          <option key={s} value={s} className="bg-abyss text-bone-white normal-case">
            {labels[s]}
          </option>
        ))}
      </select>
    </span>
  );
}
