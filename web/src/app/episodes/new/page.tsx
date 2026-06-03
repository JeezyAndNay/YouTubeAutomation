"use client";

import { useActionState } from "react";
import { startPhase1 } from "@/app/actions/episodes";
import Link from "next/link";

export default function NewEpisodePage() {
  const [state, action, pending] = useActionState(startPhase1, null);

  return (
    <div className="p-8 max-w-xl">
      <Link
        href="/episodes"
        className="text-weathered-stone hover:text-bone-white text-xs uppercase tracking-widest transition-colors mb-8 inline-block"
      >
        ← Episodes
      </Link>

      <h1 className="font-display text-xl tracking-[0.12em] uppercase text-bone-white mb-1">
        Start Phase 1
      </h1>
      <p className="text-weathered-stone text-sm mb-8">
        Triggers Research + Script + Voice packaging in n8n.
      </p>

      <form
        action={action}
        className="bg-deep-teal border border-weathered-stone/15 rounded-xl p-8 space-y-5"
      >
        <div>
          <label
            htmlFor="topic"
            className="block text-xs font-medium uppercase tracking-widest text-weathered-stone mb-2"
          >
            Topic
          </label>
          <input
            id="topic"
            name="topic"
            type="text"
            autoFocus
            required
            placeholder="e.g. The Lost City of Z"
            className="w-full bg-abyss border border-weathered-stone/25 rounded-lg px-4 py-2.5 text-bone-white outline-none focus:border-portal-gold transition-colors text-sm placeholder:text-weathered-stone/40"
          />
          <p className="text-weathered-stone/50 text-xs mt-1.5">
            Use plain English — the pipeline will slugify this automatically.
          </p>
        </div>

        {state?.error && (
          <p className="text-deep-crimson text-xs font-medium">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-portal-gold text-charcoal font-semibold text-sm py-2.5 rounded-lg hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
        >
          {pending ? "Triggering n8n..." : "Start Phase 1"}
        </button>
      </form>
    </div>
  );
}
