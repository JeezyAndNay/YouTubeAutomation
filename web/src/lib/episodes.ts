import fs from "fs";
import path from "path";

const PROJECTS_DIR = "/Users/jneal/n8n_projects";

export type EpisodePhase = 1 | 2 | 3;
export type EpisodeStatus = "idle" | "running" | "awaiting_review" | "done" | "error" | "rejected";

export type Episode = {
  slug: string;
  dir: string;
  topic: string;
  phase: EpisodePhase | null;
  status: EpisodeStatus;
  youtubeUrl?: string;
};

export function listEpisodes(): Episode[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^.+_\d{12}$/.test(d.name))
    .map((d) => deriveEpisode(d.name))
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

export function episodeDir(slug: string) {
  return path.join(PROJECTS_DIR, slug);
}

function deriveEpisode(slug: string): Episode {
  const dir = path.join(PROJECTS_DIR, slug);
  const topic = slug.replace(/_\d{12}$/, "").replace(/_/g, " ");

  const phase = detectPhase(dir);
  const status = detectStatus(dir);
  const youtubeUrl = readOptionalFile(path.join(dir, ".youtube_url"));

  return { slug, dir, topic, phase, status, youtubeUrl };
}

function detectPhase(dir: string): EpisodePhase | null {
  if (fs.existsSync(path.join(dir, "scripts", "metadata_package.json"))) return 3;
  if (fs.existsSync(path.join(dir, "scripts", "media_timeline.json")))    return 2;
  if (fs.existsSync(path.join(dir, "scripts", "script.md")))              return 1;
  return null;
}

function readOptionalFile(p: string): string | undefined {
  try { return fs.readFileSync(p, "utf-8").trim() || undefined; } catch { return undefined; }
}

function detectStatus(dir: string): EpisodeStatus {
  const marker = path.join(dir, ".status");
  if (fs.existsSync(marker)) {
    const raw = fs.readFileSync(marker, "utf-8").trim() as EpisodeStatus;
    return raw;
  }
  return "idle";
}

export function setEpisodeStatus(slug: string, status: EpisodeStatus) {
  const dir = episodeDir(slug);
  fs.writeFileSync(path.join(dir, ".status"), status, "utf-8");
}

export function getEpisode(slug: string): Episode | null {
  const dir = episodeDir(slug);
  if (!fs.existsSync(dir)) return null;
  return deriveEpisode(slug);
}

export type EpisodeOutputs = {
  research: boolean;
  script: boolean;
  voice: boolean;
  timeline: boolean;
  images: boolean;
  videos: boolean;
  metadata: boolean;
  voiceover: boolean;
};

export function getEpisodeOutputs(slug: string): EpisodeOutputs {
  const dir = episodeDir(slug);
  return {
    research:  fs.existsSync(path.join(dir, "scripts", "research_package.json")),
    script:    fs.existsSync(path.join(dir, "scripts", "script.md")),
    voice:     fs.existsSync(path.join(dir, "audio", "voice_package.json")),
    timeline:  fs.existsSync(path.join(dir, "scripts", "media_timeline.json")),
    images:    fs.existsSync(path.join(dir, "scripts", "image_manifest.json")),
    videos:    fs.existsSync(path.join(dir, "scripts", "video_manifest.json")),
    metadata:  fs.existsSync(path.join(dir, "scripts", "metadata_package.json")),
    voiceover: fs.existsSync(path.join(dir, "audio", "voiceover_final.mp3")),
  };
}

export type FileGroup = { dir: string; files: { name: string; size: number; ext: string }[] };

export function getEpisodeFiles(slug: string): FileGroup[] {
  const base = episodeDir(slug);
  if (!fs.existsSync(base)) return [];

  const groups: FileGroup[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(base, entry.name);
    const files = fs.readdirSync(subdir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const fp = path.join(subdir, e.name);
        return {
          name: e.name,
          size: fs.statSync(fp).size,
          ext: path.extname(e.name).slice(1).toLowerCase(),
        };
      });
    if (files.length > 0) groups.push({ dir: entry.name, files });
  }
  return groups;
}
