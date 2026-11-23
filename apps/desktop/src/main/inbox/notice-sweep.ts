import type Database from "libsql";
import { sendSystemMessage } from "../agents/agent-messaging";
import { atPrompt } from "../agents/follow-up-queue";
import { mainSessions } from "../agents/main-session";
import { msSincePersonInput } from "../agents/session-activity";
import { isAgentQuiet, listActiveAgents } from "../db/queries/agents";
import { listColabNews, markNoticed } from "../db/queries/inbox";
import { logger } from "../lib/logger";
import { mayNotice, NOTICE_AGENT_TURNS, noticeTargets, noticeText } from "./notice";

const CHECK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
const toldAt = new Map<string, number>();

/** One look: sessions at rest, with the person away, hear that their colab threads have news */
export function checkInboxNotices(db: Database.Database, now = Date.now()): void {
  const news = listColabNews(db, NOTICE_AGENT_TURNS);
  if (news.length === 0) {
    toldAt.clear();
    return;
  }
  const agents = listActiveAgents(db).filter((a) => a.cliType !== "shell");
  const mains = mainSessions(db, agents);
  const live = new Set(agents.map((a) => a.id));
  for (const id of toldAt.keys()) if (!live.has(id)) toldAt.delete(id);
  for (const [id, list] of noticeTargets(news, agents, (p) => mains[p]?.id)) {
    const told = toldAt.get(id);
    const free = mayNotice({
      atPrompt: atPrompt(db, id),
      quiet: isAgentQuiet(db, id),
      personMs: msSincePersonInput(id),
      toldMs: told === undefined ? null : now - told,
    });
    if (!free) continue;
    const sent = sendSystemMessage(db, {
      toAgentId: id,
      source: "Exegol inbox",
      text: noticeText(list),
    });
    if (!sent) continue;
    toldAt.set(id, now);
    // Queued (the paste failed): it lands at a later boundary, and is not sent twice
    markNoticed(db, list);
    logger.info(
      `[Inbox] notice to ${id}: ${list.length} thread(s)${sent.delivered ? "" : ", queued"}`,
    );
  }
}

export function startInboxNotices(db: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      checkInboxNotices(db);
    } catch (err) {
      logger.warn("[Inbox] notice check failed:", err);
    }
  }, CHECK_MS);
  timer.unref?.();
}
