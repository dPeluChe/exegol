import type Database from "libsql";
import { needsUser } from "../agents/agent-message-queue";
import { sendSystemMessage } from "../agents/agent-messaging";
import { listActiveAgents } from "../db/queries/agents";
import { countPersonalThreads } from "../db/queries/inbox";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { type FeedEvent, type FeedSnapshot, feedEvents, feedMessage, feedSnapshot } from "./feed";
import { sessionState } from "./fleet";
import { commanderFeed, commanderProjectId } from "./home";
import { fleetOf } from "./tools";

const CHECK_MS = 30_000;
/** Each digest is a turn the Commander pays for: at most one per window */
const FEED_GAP_MS = 2 * 60_000;
/** And a cap per hour: a session and the Commander answering each other cannot run all night */
const FEED_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;
const MAX_NOTICES = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let last: FeedSnapshot | null = null;
let sent: number[] = [];
const pending = new Map<string, FeedEvent>();
const notices = new Map<string, string>();

function reset(): void {
  last = null;
  pending.clear();
  notices.clear();
}

/** One look at the fleet: gather what changed, and send it once the Commander is free */
function checkFeed(db: Database.Database, now = Date.now()): void {
  const own = commanderFeed(db) ? commanderProjectId(db) : null;
  const agents = own ? listActiveAgents(db) : [];
  const commander = agents.find((a) => a.projectId === own && a.cliType !== "shell");
  if (!commander) {
    reset();
    return;
  }
  const next = feedSnapshot(fleetOf(db, commander.id, agents), countPersonalThreads(db));
  if (last) for (const event of feedEvents(last, next)) pending.set(event.key, event);
  last = next;

  sent = sent.filter((at) => now - at < HOUR_MS);
  if (sent.length >= FEED_PER_HOUR || now - (sent.at(-1) ?? 0) < FEED_GAP_MS) return;
  if (sessionState(commander.status, needsUser(commander.id)) !== "at_prompt") return;
  notices.delete(commander.id);
  const text = feedMessage(pending.values(), next, [...notices.values()]);
  pending.clear();
  notices.clear();
  if (!text) return;
  if (!sendSystemMessage(db, { toAgentId: commander.id, source: "Exegol feed", text })) return;
  sent.push(now);
  logger.info(`[Commander] feed sent: ${text.split("\n").length - 2} line(s)`);
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
  timer = setInterval(() => {
    try {
      checkFeed(db);
    } catch (err) {
      logger.warn("[Commander] feed check failed:", err);
    }
  }, CHECK_MS);
  timer.unref?.();
}
