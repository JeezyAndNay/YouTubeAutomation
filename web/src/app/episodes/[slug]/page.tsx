import { notFound } from "next/navigation";
import Link from "next/link";
import { getEpisode, getEpisodeOutputs, getEpisodeFiles, getPhase2FailedAssets, getPausedInfo } from "@/lib/episodes";
import StatusPill from "@/components/StatusPill";
import ArtifactPanel from "./ArtifactPanel";

export const dynamic = "force-dynamic";

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const episode = getEpisode(slug);
  if (!episode) notFound();

  const outputs = getEpisodeOutputs(slug);
  const fileGroups = getEpisodeFiles(slug);
  const failedAssets = getPhase2FailedAssets(slug);
  const pausedInfo = getPausedInfo(slug);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-8 pt-7 pb-5 border-b border-weathered-stone/15 shrink-0">
        <Link
          href="/episodes"
          className="text-weathered-stone hover:text-bone-white text-[10px] uppercase tracking-widest transition-colors mb-4 inline-block"
        >
          ← Episodes
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-lg tracking-[0.12em] uppercase text-bone-white capitalize leading-snug">
              {episode.topic}
            </h1>
            <p className="text-weathered-stone/50 text-[11px] font-mono mt-0.5">
              {episode.slug}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {episode.phase && (
              <span className="text-weathered-stone/50 text-xs">
                Phase {episode.phase}
              </span>
            )}
            <StatusPill status={episode.status} />
          </div>
        </div>
      </header>

      {/* Two-column panel */}
      <ArtifactPanel
        episode={episode}
        outputs={outputs}
        fileGroups={fileGroups}
        failedAssets={failedAssets}
        pausedInfo={pausedInfo}
      />
    </div>
  );
}
