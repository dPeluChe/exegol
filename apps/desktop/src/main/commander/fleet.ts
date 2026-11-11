import type { Project } from "@exegol/shared";
import type { ActiveAgent } from "../db/queries/agents";
import type { TalkPair } from "../db/queries/messages";

export interface FleetTalk {
  session: string;
  id: string;
  minutes_ago: number;
  /** Which way the newest message between the two went, seen from this session */
  last: "sent" | "received";
}

export interface SessionFacts {
  /** A permission prompt or a dialog on its screen: only the person answers it */
  needsUser: boolean;
  /** Milliseconds since its PTY last printed; null when never seen */
  quietMs: number | null;
  /** Milliseconds since the person last wrote to it in this run of the app; null when never */
  personMs: number | null;
  /** restart: a newer CLI is installed. release: one is out, not installed */
  cliUpdate?: "restart" | "release";
  /** Seconds: when the first row of its resume chain started */
  lineageStart?: number | null;
  talksWith?: FleetTalk[];
}

export type SessionState = "working" | "waits_on_person" | "at_prompt" | "starting";

export interface FleetSession {
  id: string;
  name: string | null;
  cli: string;
  state: SessionState;
  minutes_in_state: number | null;
  quiet_minutes: number | null;
  /** When the person last wrote to it themselves: a recent one means they are on it */
  person_minutes_ago: number | null;
  task: string;
  cli_update?: "restart" | "release";
  /** The project's main session: the person's mark, else the one whose lineage started first */
  main?: true;
  talks_with?: FleetTalk[];
}

export interface FleetProject {
  project: string;
  inbox_waiting: number;
  sessions: FleetSession[];
}

const minutes = (ms: number | null) => (ms == null ? null : Math.max(0, Math.round(ms / 60_000)));

export function sessionState(status: string, needsUser: boolean): SessionState {
  if (needsUser) return "waits_on_person";
  if (status === "running") return "working";
  if (status === "spawning") return "starting";
  return "at_prompt";
}

export const TALK_HOURS = 24;
const MAX_TALKS = 3;

export const sessionName = (s: { id: string; alias?: string | null }) =>
  s.alias || s.id.slice(0, 8);

/** The session whose lineage started first; `preferred` (a mark by the person) wins while live */
export function mainSessionId(
  sessions: { id: string; startedAt: number | null; lineageStart?: number | null }[],
  preferred?: string,
): string | null {
  if (preferred && sessions.some((s) => s.id === preferred)) return preferred;
  const own = (s: (typeof sessions)[number]) => s.startedAt ?? Number.MAX_SAFE_INTEGER;
  const [first] = [...sessions].sort(
    (a, b) =>
      (a.lineageStart ?? own(a)) - (b.lineageStart ?? own(b)) ||
      own(a) - own(b) ||
      (a.id < b.id ? -1 : 1),
  );
  return first?.id ?? null;
}

/** Per session, the ones it exchanged messages with, most recent first */
export function talksWith(
  pairs: TalkPair[],
  names: Map<string, string>,
  now = Date.now(),
): Map<string, FleetTalk[]> {
  const latest = new Map<string, Map<string, FleetTalk & { seq: number }>>();
  const note = (
    self: string,
    id: string,
    session: string,
    pair: TalkPair,
    last: "sent" | "received",
  ) => {
    const mine = latest.get(self) ?? new Map<string, FleetTalk & { seq: number }>();
    if (pair.seq > (mine.get(id)?.seq ?? -1)) {
      const minutes_ago = Math.max(0, Math.round((now - pair.at * 1000) / 60_000));
      mine.set(id, { session, id, minutes_ago, last, seq: pair.seq });
    }
    latest.set(self, mine);
  };
  for (const pair of pairs) {
    const from = names.get(pair.fromId);
    const to = names.get(pair.toId);
    if (from === undefined || to === undefined || pair.fromId === pair.toId) continue;
    note(pair.fromId, pair.toId, to, pair, "sent");
    note(pair.toId, pair.fromId, from, pair, "received");
  }
  return new Map(
    [...latest].map(([self, others]) => [
      self,
      [...others.values()]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, MAX_TALKS)
        .map(({ seq: _seq, ...talk }) => talk),
    ]),
  );
}

/** Every project, the Commander's own left out; sessions that need the person first */
export function fleetView(
  projects: Pick<Project, "id" | "name">[],
  agents: ActiveAgent[],
  facts: (agentId: string) => SessionFacts,
  inboxWaiting: (projectId: string) => number,
  now = Date.now(),
  preferredMain?: (projectId: string) => string | undefined,
): FleetProject[] {
  const order: SessionState[] = ["waits_on_person", "at_prompt", "working", "starting"];
  return projects.map((p) => {
    const sessions = agents
      .filter((a) => a.projectId === p.id && a.cliType !== "shell")
      .map((a) => ({ agent: a, facts: facts(a.id) }));
    const main = mainSessionId(
      sessions.map((s) => ({
        id: s.agent.id,
        startedAt: s.agent.startedAt,
        lineageStart: s.facts.lineageStart,
      })),
      preferredMain?.(p.id),
    );
    return {
      project: p.name,
      inbox_waiting: inboxWaiting(p.id),
      sessions: sessions
        .map(({ agent: a, facts: f }): FleetSession => {
          const since = a.statusChangedAt ? now - a.statusChangedAt * 1000 : null;
          return {
            id: a.id,
            name: a.alias ?? null,
            cli: a.cliType,
            state: sessionState(a.status, f.needsUser),
            minutes_in_state: minutes(since),
            quiet_minutes: minutes(f.quietMs),
            person_minutes_ago: minutes(f.personMs),
            task: a.taskDescription.slice(0, 120),
            ...(f.cliUpdate ? { cli_update: f.cliUpdate } : {}),
            ...(a.id === main ? { main: true } : {}),
            ...(f.talksWith?.length ? { talks_with: f.talksWith } : {}),
          };
        })
        .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)),
    };
  });
}
