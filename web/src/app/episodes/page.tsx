import { listEpisodes } from "@/lib/episodes";
import StatusSelect from "@/components/StatusSelect";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  const episodes = listEpisodes();

  return (
    <div className="p-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-xl tracking-[0.12em] uppercase text-bone-white">
            Episode Dashboard
          </h1>
          <p className="text-weathered-stone text-sm mt-1">
            {episodes.length} episode{episodes.length !== 1 ? "s" : ""} on disk
          </p>
        </div>

        <Link
          href="/episodes/new"
          className="bg-portal-gold text-charcoal font-semibold text-sm px-5 py-2.5 rounded hover:bg-amber-torchlight transition-colors"
        >
          Start Phase 1
        </Link>
      </div>

      {/* Episode grid */}
      {episodes.length === 0 ? (
        <div className="border border-weathered-stone/20 rounded-lg p-12 text-center">
          <p className="text-weathered-stone text-sm">No episodes found in n8n_projects.</p>
          <p className="text-weathered-stone/60 text-xs mt-1">
            Start Phase 1 to create the first episode folder.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {episodes.map((ep) => (
            <Link
              key={ep.slug}
              href={`/episodes/${ep.slug}`}
              className="block bg-deep-teal border border-weathered-stone/15 rounded-lg px-6 py-4 hover:border-weathered-stone/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-bone-white font-semibold capitalize truncate group-hover:text-portal-gold transition-colors">
                    {ep.topic}
                  </h2>
                  <p className="text-weathered-stone text-xs mt-0.5 font-mono">{ep.slug}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
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
    </div>
  );
}
