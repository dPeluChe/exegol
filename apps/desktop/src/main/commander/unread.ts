import { type CommanderUnread, NO_COMMANDER_UNREAD } from "@exegol/shared";
import type Database from "libsql";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { isCommander } from "./home";

const KEY = "commander_unread";

let turnStart: number | null = null;
// A turn end can arrive by two paths (terminal and file event): one count per turn
let open = true;

export function commanderUnread(db: Database.Database): CommanderUnread {
  const saved = getJsonSetting<Partial<CommanderUnread> | null>(db, KEY, null);
  const count = typeof saved?.count === "number" && saved.count > 0 ? Math.floor(saved.count) : 0;
  if (!count) return NO_COMMANDER_UNREAD;
  return { count, since: typeof saved?.since === "number" ? saved.since : null };
}

/** A turn boundary of any session: the Commander's ended turns count until a chat shows them */
export function noteCommanderTurn(
  db: Database.Database,
  agent: { projectId: string },
  event: "turn_started" | "finished",
  now = Date.now(),
): void {
  try {
    count(db, agent, event, now);
  } catch (err) {
    // The output path calls this: a failed setting read must not stop a status change
    logger.warn("[Commander] unread count not kept:", err);
  }
}

function count(
  db: Database.Database,
  agent: { projectId: string },
  event: "turn_started" | "finished",
  now: number,
): void {
  if (!isCommander(db, agent)) return;
  if (event === "turn_started") {
    turnStart = now;
    open = true;
    return;
  }
  if (!open) return;
  open = false;
  const was = commanderUnread(db);
  save(db, {
    count: was.count + 1,
    since: was.since ?? Math.floor((turnStart ?? now) / 1000),
  });
}

/** Its chat is in view in some window */
export function markCommanderRead(db: Database.Database): CommanderUnread {
  if (commanderUnread(db).count) save(db, NO_COMMANDER_UNREAD);
  return NO_COMMANDER_UNREAD;
}

function save(db: Database.Database, next: CommanderUnread): void {
  setJsonSetting(db, KEY, next);
  broadcast("commander:unread", next);
}

/** For tests */
export function resetCommanderTurn(): void {
  turnStart = null;
  open = true;
}
