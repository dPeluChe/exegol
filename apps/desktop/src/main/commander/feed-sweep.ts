import type Database from "libsql";
import { needsUser } from "../agents/agent-message-queue";
import { sendSystemMessage } from "../agents/agent-messaging";
import { listActiveAgents } from "../db/queries/agents";
import { countPersonalThreads } from "../db/queries/inbox";
import { listTalkSince, messageCursor } from "../db/queries/messages";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { isReadingAloud } from "../speech/reading";
import {
  ENDED,
  type FeedEvent,
  type FeedSnapshot,
  feedEvents,
  feedMessage,
  feedSnapshot,
  stoppedLine,
  talkEvents,
} from "./feed";
import { sessionState } from "./fleet";
import { commanderFeed, commanderProjectId } from "./home";
import { stoppedOnError } from "./retry";
import { fleetOf } from "./tools";

const CHECK_MS = 30_000;
/** Each digest is a turn the Commander pays for: at most one per window */
const FEED_GAP_MS = 3 * 60_000;
/** And a cap per hour: a session and the Commander answering each other cannot run all night */
const FEED_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;
const MAX_NOTICES = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let last: FeedSnapshot | null = null;
let lastMessageRow: number | null = null;
let sent: number[] = [];
const pending = new Map<string, FeedEvent>();
const notices = new Map<string, string>();

function reset(): void {
  last = null;
  lastMessageRow = null;
  pending.clear();
  notices.clear();
}

/** One look at the fleet: gather what changed, and send it once the Commander is free */
async function checkFeed(db: Database.Database, now = Date.now()): Promise<void> {
  const own = commanderFeed(db) ? commanderProjectId(db) : null;
  const agents = own ? listActiveAgents(db) : [];
  const commander = agents.find((a) => a.projectId === own && a.cliType !== "shell");
  if (!commander) {
    reset();
    return;
  }
  const next = feedSnapshot(fleetOf(db, commander.id, agents), countPersonalThreads(db));
  const events = last ? feedEvents(last, next) : [];
  last = next;
  for (const event of events) {
    const turnEnded = event.holds?.state === "at_prompt" && event.line.endsWith(ENDED);
    const ended = turnEnded ? next.sessions.get(event.key) : undefined;
    const stopped = ended && (await stoppedOnError(db, event.key));
    const line = stopped ? stoppedLine(`${ended.name} (${ended.project})`) : event.line;
    pending.set(event.key, { ...event, line });
  }
  const top = messageCursor(db);
  if (lastMessageRow !== null && top > lastMessageRow) {
    const talk = listTalkSince(db, [...next.sessions.keys()], lastMessageRow);
    for (const event of talkEvents(talk, next.sessions)) pending.set(event.key, event);
  }
  lastMessageRow = top;

  sent = sent.filter((at) => now - at < HOUR_MS);
  if (sent.length >= FEED_PER_HOUR || now - (sent.at(-1) ?? 0) < FEED_GAP_MS) return;
  if (sessionState(commander.status, needsUser(commander.id)) !== "at_prompt") return;
  // A reply is being heard: what gathers meanwhile goes as one message when it ends
  if (isReadingAloud(now)) return;
  notices.delete(commander.id);
  const text = feedMessage(pending.values(), next, [...notices.values()]);
  pending.clear();
  notices.clear();
  if (!text) return;
  if (!sendSystemMessage(db, { toAgentId: commander.id, source: "Exegol feed", text })) return;
  sent.push(now);
  logger.info(`[Commander] feed sent: ${text.split("\n- ").length - 1} line(s)`);
}

export function startCommanderFeed(db: Database.Database): void {
  if (timer) return;
  // Stuck turns and held messages: Exegol's own titles, one per session
  getNotificationBus().register({
    id: "commander-feed",
    deliver(event) {
      if (event.type !== "agent:notice" || !event.agentId || !last) return;
      if (notices.size < MAX_NOTICES) notices.set(event.agentId, event.title);
    },
  });
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    checkFeed(db)
      .catch((err) => logger.warn("[Commander] feed check failed:", err))
      .finally(() => {
        busy = false;
      });
  }, CHECK_MS);
  timer.unref?.();
}
