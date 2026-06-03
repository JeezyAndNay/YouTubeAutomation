"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);

  return (
    <div className="min-h-screen bg-abyss flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="font-display text-2xl tracking-[0.16em] uppercase text-portal-gold mb-1">
            Ruins Untold
          </h1>
          <p className="text-weathered-stone text-sm tracking-widest uppercase">
            Production Pipeline
          </p>
        </div>

        <form
          action={action}
          className="bg-deep-teal border border-weathered-stone/15 rounded-xl p-8 space-y-5"
        >
          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-widest text-weathered-stone mb-2"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="w-full bg-abyss border border-weathered-stone/25 rounded-lg px-4 py-2.5 text-bone-white outline-none focus:border-portal-gold transition-colors text-sm"
              placeholder="Enter pipeline password"
            />
          </div>

          {state?.error && (
            <p className="text-deep-crimson text-xs font-medium">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-portal-gold text-charcoal font-semibold text-sm py-2.5 rounded-lg hover:bg-amber-torchlight disabled:opacity-40 transition-colors"
          >
            {pending ? "Authenticating…" : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
