import type Database from "libsql";
import { chatTurns } from "../agents/session-chat";
import { isCommander } from "../commander/home";
import { logger } from "../lib/logger";

/** The transcript gets its last line a moment after the turn ends */
const SETTLE_MS = 1_500;

/** The Commander ended a turn: its reply's audio is made now, whether or not its chat is open */
export function prepareCommanderReply(
  db: Database.Database,
  agent: { id: string; projectId: string },
): void {
  const timer = setTimeout(() => {
    void Promise.resolve()
      .then(() => (isCommander(db, agent) ? chatTurns(db, agent.id, undefined) : null))
      .then((page) => {
        const last = page?.turns.at(-1);
        if (last?.role !== "assistant") return;
        // Loaded here: the engine needs Electron, which the callers' tests run without
        return import("./reply-audio").then((m) => m.prepareReplyAudio(last.text));
      })
      .catch(() => logger.warn("[Speech] could not prepare the reply"));
  }, SETTLE_MS);
  timer.unref?.();
}
