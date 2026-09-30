import { net } from "electron";
import { gt, lte, valid } from "semver";
import { logger } from "../lib/logger";
import { EXEGOL_REPO_SLUG } from "../lib/repo";

interface ReleaseNote {
  version: string;
  /** ISO date the release was published */
  date: string | null;
  /** The release body: the CHANGELOG section for that version (markdown) */
  body: string;
}

interface GithubRelease {
  tag_name: string;
  published_at: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

/** Releases after `from` up to `to`, newest first: a user who skipped versions sees them all */
export function notesBetween(
  releases: GithubRelease[],
  from: string | null,
  to: string,
): ReleaseNote[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ r, version: valid(r.tag_name.replace(/^v/, "")) }))
    .filter(
      (x): x is { r: GithubRelease; version: string } =>
        !!x.version && lte(x.version, to) && (!from || gt(x.version, from)),
    )
    .sort((a, b) => (gt(a.version, b.version) ? -1 : 1))
    .map(({ r, version }) => ({ version, date: r.published_at, body: (r.body ?? "").trim() }));
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; releases: GithubRelease[] } | null = null;

/** The public GitHub releases (no token: 60 requests an hour is plenty, and it is cached) */
async function listReleases(): Promise<GithubRelease[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.releases;
  const res = await net.fetch(
    `https://api.github.com/repos/${EXEGOL_REPO_SLUG}/releases?per_page=30`,
    {
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  const releases = (await res.json()) as GithubRelease[];
  cache = { at: Date.now(), releases };
  return releases;
}

/** Notes are a nicety: offline or rate-limited, the update still happens without them */
export async function fetchReleaseNotes(from: string | null, to: string): Promise<ReleaseNote[]> {
  try {
    return notesBetween(await listReleases(), from, to);
  } catch (err) {
    logger.info(`[ReleaseNotes] Not available: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
