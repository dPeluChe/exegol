import { basename } from "node:path";
import type Database from "libsql";
import { insertCommanderLog } from "../db/queries/commander-log";
import { logger } from "../lib/logger";

/** What the Commander changed, kept for good: reads are not history */
const ACTIONS = new Set([
  "agent_send",
  "message_cancel",
  "inbox_post",
  "inbox_reply",
  "inbox_take",
  "inbox_close",
  "note_write",
  "note_retire",
  "session_suspend",
  "session_restart",
  "session_retry",
  "project_add",
  "alert_person",
]);

const SUMMARY_CHARS = 160;
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const short = (value: unknown): string | null => str(value)?.slice(0, SUMMARY_CHARS) ?? null;

/** Who or where the action landed, from the arguments the Commander gave */
function logTarget(action: string, args: Record<string, unknown>): string | null {
  if (action === "project_add") {
    return str(args.name) ?? (str(args.path) ? basename(str(args.path) as string) : null);
  }
  if (action === "agent_send") return str(args.target) ?? str(args.target_id);
  if (action === "alert_person") return null;
  if (action.startsWith("session_")) return str(args.session);
  return str(args.project) ?? (args.target === "personal" ? "Personal" : "Commander");
}

/** Its own words, cut short: the full text stays in the message, thread or note */
function logSummary(action: string, args: Record<string, unknown>): string | null {
  if (action === "agent_send" || action === "alert_person") return short(args.message);
  if (action === "inbox_close") return short(args.resolution);
  if (action === "note_retire") return short(args.reason);
  if (action === "inbox_reply") return short(args.body);
  return short(args.title);
}

function refOf(args: Record<string, unknown>, result: unknown): string | null {
  const r = (result ?? {}) as Record<string, unknown>;
  return str(r.messageId) ?? str(r.thread) ?? str(r.id) ?? str(args.thread) ?? str(args.id);
}

/** Runs a Commander tool call and records what it did, or that it was refused and why */
export async function recorded<T>(
  db: Database.Database,
  sessionId: string,
  action: string,
  args: Record<string, unknown>,
  run: () => T | Promise<T>,
): Promise<T> {
  if (!ACTIONS.has(action)) return run();
  const entry = { sessionId, action, target: logTarget(action, args) };
  const save = (rest: {
    outcome: "done" | "refused";
    summary: string | null;
    ref: string | null;
  }) => {
    try {
      insertCommanderLog(db, { ...entry, ...rest });
    } catch (err) {
      logger.warn("[Commander] history not written:", err);
    }
  };
  try {
    const result = await run();
    save({ outcome: "done", summary: logSummary(action, args), ref: refOf(args, result) });
    return result;
  } catch (err) {
    save({
      outcome: "refused",
      summary: short(err instanceof Error ? err.message : ""),
      ref: null,
    });
    throw err;
  }
}
