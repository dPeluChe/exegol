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

/**
 * Whether this CLI recorded any session in `cwd`: a generic resume flag
 * (`--continue`, `resume --last`) exits with an error when there is none, which
 * turned "Resume" on a fresh folder into a failed agent. null = no adapter for
 * this CLI, so the caller can't tell and keeps the flag.
 */
export async function hasLocalSession(provider: string, cwd: string): Promise<boolean | null> {
  const adapter = PROVIDERS.find((p) => p.id === provider);
  if (!adapter) return null;
  try {
    // A recent window: codex stores rollouts by day across every repo, and
    // since=0 read the head of every one of them before each resume spawn
    return (await adapter.list([cwd], Date.now() / 1000 - RESUME_WINDOW_S)).length > 0;
  } catch (err) {
    logger.warn(`[History] ${provider} store unreadable:`, err);
    return null;
  }
}

const RESUME_WINDOW_S = 90 * 24 * 3600;

/** A CLI writes its first transcript line within seconds of launch; minutes covers a slow start */
const START_MATCH_S = 300;

/**
 * Which recorded session an agent was running, when Exegol never learned its id
 * (a reboot kills the PTY before the CLI prints its resume line). The one that
 * began right after the agent did; else one already open when it began (a
 * resumed conversation). Sessions another agent owns are never picked.
 */
export function pickLostSession(
  sessions: LocalSession[],
  agentStartedAt: number,
  claimed: Set<string>,
): LocalSession | null {
  const free = sessions.flatMap((s) =>
    s.startedAt !== null && !claimed.has(s.sessionId) ? [{ s, start: s.startedAt }] : [],
  );
  const byStart = free
    .filter(({ start }) => start >= agentStartedAt - 30 && start <= agentStartedAt + START_MATCH_S)
    .sort((a, b) => Math.abs(a.start - agentStartedAt) - Math.abs(b.start - agentStartedAt));
  if (byStart[0]) return byStart[0].s;
  const spanning = free
    .filter(({ s, start }) => start < agentStartedAt && (s.endedAt ?? 0) >= agentStartedAt)
    .sort((a, b) => (b.s.endedAt ?? 0) - (a.s.endedAt ?? 0));
  return spanning[0]?.s ?? null;
}

export async function findLostSession(
  provider: string,
  cwd: string,
  agentStartedAt: number,
  claimed: Set<string>,
): Promise<LocalSession | null> {
  const adapter = PROVIDERS.find((p) => p.id === provider);
  if (!adapter) return null;
  try {
    // Modified since the agent started: the session it ran was written to after that
    return pickLostSession(await adapter.list([cwd], agentStartedAt), agentStartedAt, claimed);
  } catch (err) {
    logger.warn(`[History] ${provider} store unreadable:`, err);
    return null;
  }
}
