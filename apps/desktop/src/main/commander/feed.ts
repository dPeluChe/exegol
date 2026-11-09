import type { FleetProject, SessionState } from "./fleet";

export interface FeedSnapshot {
  sessions: Map<string, { name: string; project: string; state: SessionState }>;
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

export function feedSnapshot(fleet: FleetProject[], personalWaiting: number): FeedSnapshot {
  const sessions: FeedSnapshot["sessions"] = new Map();
  const inbox: FeedSnapshot["inbox"] = new Map([["", personalWaiting]]);
  for (const p of fleet) {
    inbox.set(p.project, p.inbox_waiting);
    for (const s of p.sessions) {
      sessions.set(s.id, { name: s.name ?? s.id.slice(0, 8), project: p.project, state: s.state });
    }
  }
  return { sessions, inbox };
}

/** What changed between two looks at the fleet, as the Commander should hear it */
export function feedEvents(prev: FeedSnapshot, next: FeedSnapshot): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const [id, now] of next.sessions) {
    const before = prev.sessions.get(id);
    if (!before || before.state === now.state) continue;
    const who = `${now.name} (${now.project})`;
    if (now.state === "waits_on_person") {
      events.push({
        key: id,
        line: `${who} waits on the person: a permission or dialog on its screen`,
        holds: { sessionId: id, state: "waits_on_person" },
      });
    } else if (now.state === "at_prompt" && before.state !== "waits_on_person") {
      events.push({
        key: id,
        line: `${who} ended its turn`,
        holds: { sessionId: id, state: "at_prompt" },
      });
    }
  }
  for (const [id, before] of prev.sessions) {
    if (!next.sessions.has(id)) {
      events.push({ key: id, line: `${before.name} (${before.project}) closed` });
    }
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
    "Read a session with session_read before you act on it. Tell the person only what they need.",
  ].join("\n");
}
