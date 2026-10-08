import { logger } from "../lib/logger";
import { AsyncLruCache } from "../lib/lru-cache";
import { forgetCliListing } from "./cli-list";
import { claudeCodeHistory, claudeSessionName } from "./providers/claude-code";
import { codexHistory } from "./providers/codex";
import { devinHistory } from "./providers/devin";
import { droidHistory } from "./providers/droid";
import { geminiHistory } from "./providers/gemini";
import { gooseHistory } from "./providers/goose";
import { kilocodeHistory } from "./providers/kilocode";
import { opencodeHistory } from "./providers/opencode";
import { type LocalHistoryProvider, type LocalSession, StoreUnavailable } from "./types";

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
  devinHistory,
  kilocodeHistory,
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

/** A past agent whose provider session id is known, and the folder it ran in */
export interface NamedSessionRef {
  agentId: string;
  provider: string;
  sessionId: string;
  cwd: string;
  task: string;
}

/**
 * Each agent's session name inside its CLI, by agent id. Claude reads the one transcript by id;
 * other CLIs list once per provider and folder (a shared store only within the resume window, so
 * an older codex or goose session gets no name). Titles that only repeat the task are dropped.
 */
export async function cliSessionNames(refs: NamedSessionRef[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const claude = refs.filter((r) => r.provider === "claude-code");
  await Promise.all(
    claude.map(async (r) => {
      const name = await claudeSessionName(r.cwd, r.sessionId);
      if (name && !repeatsTask(name, r.task)) names[r.agentId] = name;
    }),
  );
  const groups = new Map<string, NamedSessionRef[]>();
  for (const r of refs) {
    if (r.provider === "claude-code") continue;
    const key = `${r.provider}\0${r.cwd}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const [{ provider, cwd }] = group as [NamedSessionRef];
      const shared = PROVIDERS.find((p) => p.id === provider)?.sharedStore;
      const since = shared ? Date.now() / 1000 - RESUME_WINDOW_S : 0;
      const sessions = await listLocal(provider, cwd, since);
      for (const r of group) {
        const s = sessions?.find((x) => x.sessionId === r.sessionId);
        const name = s?.name?.trim() || s?.title;
        if (name && !repeatsTask(name, r.task)) names[r.agentId] = name;
      }
    }),
  );
  return names;
}

/** A CLI that titles a session by its first prompt only repeats what the chip already shows */
export function repeatsTask(name: string, task: string): boolean {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const n = norm(name);
  const t = norm(task);
  return t !== "" && n.startsWith(t);
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
        // A CLI that is not installed has no history: not worth a warning on every refetch
        if (!(err instanceof StoreUnavailable)) {
          logger.warn(`[History] ${provider.id} store unreadable:`, err);
        }
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
 * this CLI or its store can't be read, so the caller can't tell and keeps the flag.
 */
export async function hasLocalSession(provider: string, cwd: string): Promise<boolean | null> {
  const last = await lastLocalSession(provider, cwd);
  return last === undefined ? null : last !== null;
}

/**
 * The newest session this CLI recorded in `cwd`: null = none, undefined = can't tell. Sessions in
 * `claimed` (run by a live agent) are skipped: a by-id resume must never join a sibling's session
 */
export async function lastLocalSession(
  provider: string,
  cwd: string,
  claimed: ReadonlySet<string> = new Set(),
): Promise<LocalSession | null | undefined> {
  const adapter = PROVIDERS.find((p) => p.id === provider);
  if (!adapter) return undefined;
  // A resume flag reaches sessions of any age. Only a store shared by every repo is held to a
  // window: codex files rollouts by day, and since=0 read the head of each one before a spawn
  const since = adapter.sharedStore ? Date.now() / 1000 - RESUME_WINDOW_S : 0;
  const sessions = await listLocal(provider, cwd, since);
  if (!sessions) return undefined;
  return sessions
    .filter((s) => !claimed.has(s.sessionId))
    .reduce<LocalSession | null>(
      (newest, s) => (newest && (newest.endedAt ?? 0) >= (s.endedAt ?? 0) ? newest : s),
      null,
    );
}

/** An agent of this CLI ended in `cwd`: the next check must see the session it just wrote */
export function forgetLocalSessions(provider: string, cwd: string): void {
  forgetCliListing(provider, cwd);
}

/** One provider's sessions in `cwd`; null = no adapter or an unreadable store */
async function listLocal(
  provider: string,
  cwd: string,
  since: number,
): Promise<LocalSession[] | null> {
  const adapter = PROVIDERS.find((p) => p.id === provider);
  if (!adapter) return null;
  try {
    return await adapter.list([cwd], since);
  } catch (err) {
    if (!(err instanceof StoreUnavailable)) {
      logger.warn(`[History] ${provider} store unreadable:`, err);
    }
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
  // Modified since the agent started: the session it ran was written to after that
  const sessions = await listLocal(provider, cwd, agentStartedAt);
  return sessions ? pickLostSession(sessions, agentStartedAt, claimed) : null;
}
