import { logger } from "../lib/logger";
import { claudeCodeHistory } from "./providers/claude-code";
import { codexHistory } from "./providers/codex";
import { opencodeHistory } from "./providers/opencode";
import type { LocalHistoryProvider, LocalSession } from "./types";

export type { LocalSession } from "./types";

/**
 * Providers whose on-disk format has been verified against a real store. A CLI
 * missing here is not "unsupported" — it simply has no adapter yet, and adding
 * one is a file in `providers/` plus a line below.
 */
const PROVIDERS: LocalHistoryProvider[] = [claudeCodeHistory, codexHistory, opencodeHistory];

/** Scanning the stores means filesystem work per call, and the History view
 *  remounts every time the tab is opened. */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; sessions: LocalSession[] }>();

/**
 * Every session the installed CLIs recorded for these directories, whoever
 * launched them. One slow or broken store must not hide the others, so each
 * provider is isolated and a failure logs rather than throws.
 */
export async function listLocalSessions(cwds: string[], since: number): Promise<LocalSession[]> {
  const key = `${since}:${[...cwds].sort().join("|")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.sessions;

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

  const sessions = results.flat().sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  cache.set(key, { at: Date.now(), sessions });
  return sessions;
}
