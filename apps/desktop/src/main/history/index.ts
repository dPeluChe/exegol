import { logger } from "../lib/logger";
import { AsyncLruCache } from "../lib/lru-cache";
import { claudeCodeHistory } from "./providers/claude-code";
import { codexHistory } from "./providers/codex";
import { droidHistory } from "./providers/droid";
import { geminiHistory } from "./providers/gemini";
import { gooseHistory } from "./providers/goose";
import { opencodeHistory } from "./providers/opencode";
import type { LocalHistoryProvider, LocalSession } from "./types";

export type { LocalSession } from "./types";

/**
 * Providers whose on-disk format has been verified against a real store. A CLI
 * missing here is not "unsupported" — it simply has no adapter yet, and adding
 * one is a file in `providers/` plus a line below.
 */
const PROVIDERS: LocalHistoryProvider[] = [
  claudeCodeHistory,
  codexHistory,
  opencodeHistory,
  droidHistory,
  gooseHistory,
  geminiHistory,
];

/**
 * Scanning the stores is filesystem work, and the History view remounts every
 * time the tab is opened. Keyed on `days` rather than the derived `since`: an
 * epoch computed per request changes every second, so a TTL map keyed on it
 * never hits and grows an entry per request-second. Bounded + in-flight dedup
 * comes from the existing cache, so two panes mounting together scan once.
 */
/** TTL matches the renderer's staleTime: a session the user just ran in their
 *  own terminal must show up on the next refetch, not on the next app restart. */
const cache = new AsyncLruCache<string, LocalSession[]>(16, 15_000);

/**
 * Every session the installed CLIs recorded for these directories, whoever
 * launched them. One slow or broken store must not hide the others, so each
 * provider is isolated and a failure logs rather than throws.
 */
export async function listLocalSessions(
  cwds: string[],
  since: number,
  windowKey: string,
): Promise<LocalSession[]> {
  const key = `${windowKey}:${[...cwds].sort().join("|")}`;
  return cache.getOrCompute(key, () => scan(cwds, since));
}

async function scan(cwds: string[], since: number): Promise<LocalSession[]> {
  // Deliberately NOT filtered by the registry's `enabled` flag. That flag
  // means "hide from the launcher" — gemini carries it, superseded by agy —
  // and a retired CLI's PAST sessions are precisely what a history view is
  // for. Filtering on it shipped gemini's adapter dead on every install.
  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        return await provider.list(cwds, since);
      } catch (err) {
        logger.warn(`[History] ${provider.id} store unreadable:`, err);
        return [];
      }
    }),
  );

  // Ordering is the merge's job — it has both sources and the startedAt
  // fallback; sorting here too would be a second rule that disagrees.
  return results.flat();
}
