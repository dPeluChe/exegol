import type { SessionMove } from "../db/queries/agent-lineage";
import type { NewTalk } from "../db/queries/messages";
import { type FleetProject, type SessionState, sessionName } from "./fleet";

export interface FeedSnapshot {
  sessions: Map<
    string,
    {
      name: string;
      project: string;
      state: SessionState;
      attended: boolean;
      /** Minutes at its prompt with nothing from the person since; 0 otherwise */
      unanswered: number;
    }
  >;
  /** Threads waiting per project name; "" is the personal inbox */
  inbox: Map<string, number>;
}

export interface FeedEvent {
  /** One line per key: a later event about the same thing replaces the earlier one */
  key: string;
  line: string;
  /** Dropped at send time unless the session is still in this state */
  holds?: { sessionId: string; state: SessionState };
}

export const FEED_MAX_LINES = 12;
/** The person wrote to it this recently: its turn ends are theirs to read, not the Commander's */
const ATTENDED_MINUTES = 10;
/** At its prompt this long with no word from the person: the Commander asks them how to go on */
export const UNANSWERED_MINUTES = 15;

function unansweredMinutes(s: FleetProject["sessions"][number]): number {
  const idle = s.state === "at_prompt" ? (s.minutes_in_state ?? 0) : 0;
  const wroteSince = s.person_minutes_ago !== null && s.person_minutes_ago <= idle;
  return wroteSince ? 0 : idle;
}

export function feedSnapshot(fleet: FleetProject[], personalWaiting: number): FeedSnapshot {
  const sessions: FeedSnapshot["sessions"] = new Map();
  const inbox: FeedSnapshot["inbox"] = new Map([["", personalWaiting]]);
  for (const p of fleet) {
    inbox.set(p.project, p.inbox_waiting);
    for (const s of p.sessions) {
      sessions.set(s.id, {
        name: sessionName({ id: s.id, alias: s.name }),
        project: p.project,
        state: s.state,
        attended: s.person_minutes_ago !== null && s.person_minutes_ago < ATTENDED_MINUTES,
        unanswered: unansweredMinutes(s),
      });
    }
  }
  return { sessions, inbox };
}

/** What changed between two looks at the fleet, as the Commander should hear it */
export function feedEvents(
  prev: FeedSnapshot,
  next: FeedSnapshot,
  moves: Map<string, SessionMove> = new Map(),
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const continued = new Set<string>();
  for (const [id, now] of next.sessions) {
    const before = prev.sessions.get(id);
    const who = `${now.name} (${now.project})`;
    if (!before) {
      const source = moves.get(id)?.resumedFrom;
      if (!source) continue;
      continued.add(source);
      // Same key as its "suspended" line: one not sent yet becomes this one
      const verb = prev.sessions.has(source) ? "restarted" : "resumed";
      events.push({ key: source, line: `${who} ${verb}: the same session, still open` });
      continue;
    }
    if (before.unanswered < UNANSWERED_MINUTES && now.unanswered >= UNANSWERED_MINUTES) {
      events.push({
        key: id,
        line: `${who} has been at its prompt ${now.unanswered} min with no reply from the person: read it and ask them how to go on`,
        holds: { sessionId: id, state: "at_prompt" },
      });
    }
    if (before.state === now.state) continue;
    if (now.state === "waits_on_person") {
      events.push({
        key: id,
        line: `${who} waits on the person: a permission or dialog on its screen`,
        holds: { sessionId: id, state: "waits_on_person" },
      });
    } else if (now.state === "at_prompt" && before.state !== "waits_on_person" && !now.attended) {
      events.push({
        key: id,
        line: `${who} ${ENDED}`,
        holds: { sessionId: id, state: "at_prompt" },
      });
    }
  }
  for (const [id, before] of prev.sessions) {
    if (next.sessions.has(id) || continued.has(id)) continue;
    const end = moves.get(id)?.suspended
      ? "suspended: its work is kept, it can be resumed"
      : "closed";
    events.push({ key: id, line: `${before.name} (${before.project}) ${end}` });
  }
  for (const [project, count] of next.inbox) {
    if (count > (prev.inbox.get(project) ?? 0)) {
      events.push({
        key: `inbox:${project}`,
        line: project ? `New inbox thread in ${project}` : "New thread in the personal inbox",
      });
    }
  }
  return events;
}

const count = (n: number, unit: string) =>
  `${n.toLocaleString("en-US")} ${unit}${n === 1 ? "" : "s"}`;

/** Sessions that wrote to each other: one line per ordered pair, names and length only */
export function talkEvents(rows: NewTalk[], sessions: FeedSnapshot["sessions"]): FeedEvent[] {
  const pairs = new Map<string, { who: string; messages: number; chars: number }>();
  for (const row of rows) {
    const from = sessions.get(row.fromId);
    const to = sessions.get(row.toId);
    if (!from || !to || row.fromId === row.toId) continue;
    const key = `talk:${row.fromId}>${row.toId}`;
    const verb = row.answered ? "answered" : "wrote to";
    const pair = pairs.get(key) ?? {
      who:
        from.project === to.project
          ? `${from.name} ${verb} ${to.name} in ${from.project}`
          : `${from.name} (${from.project}) ${verb} ${to.name} (${to.project})`,
      messages: 0,
      chars: 0,
    };
    pair.messages += 1;
    pair.chars += row.chars;
    pairs.set(key, pair);
  }
  return [...pairs].map(([key, { who, messages, chars }]) => {
    const size = count(chars, "character");
    return {
      key,
      line: `${who} (${messages > 1 ? `${count(messages, "message")}, ${size}` : size})`,
    };
  });
}

/** The message, or null when nothing in it still holds */
export function feedMessage(
  pending: Iterable<FeedEvent>,
  now: FeedSnapshot,
  notices: string[],
): string | null {
  const lines = [...pending]
    .filter((e) => !e.holds || now.sessions.get(e.holds.sessionId)?.state === e.holds.state)
    .map((e) => e.line)
    .concat(notices);
  if (lines.length === 0) return null;
  const shown = lines.slice(0, FEED_MAX_LINES).map((l) => `- ${l}`);
  if (lines.length > shown.length) shown.push(`- and ${lines.length - shown.length} more`);
  return [
    "Feed from Exegol, not from the person. Since your last look:",
    ...shown,
    "",
    "Read a session with session_read before you act on it, and what two sessions wrote to each " +
      "other with session_messages. Tell the person only what they need.",
  ].join("\n");
}

export const ENDED = "ended its turn";

export const stoppedLine = (who: string) =>
  `${who} stopped on an API or network error: session_retry continues it`;
