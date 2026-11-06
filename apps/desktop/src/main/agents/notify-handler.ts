// Agent lifecycle event system — watches ~/.exegol/events/ for hook-generated events.

import { type FSWatcher, readFileSync, unlinkSync, watch } from "node:fs";
import { join } from "node:path";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { getEventsDir } from "./wrappers";

// ─── Structured event types ────────────────────────────────────────────────

type AgentEventType =
  | "task_complete"
  | "task_failed"
  | "permission_needed"
  | "tool_use"
  | "prompt_submit"
  | "session_start"
  | "stop";

interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  ts: number;
  /** Provider session id from the hook payload (Claude Code), empty when absent */
  sessionId?: string;
  /** The CLI's working folder from the hook payload, empty when absent */
  cwd?: string;
  /** The tool's name on tool_use, never its input */
  tool?: string;
  payload?: Record<string, unknown>;
}

type EventCallback = (event: AgentEvent) => void;

// ─── Event log persistence ──────────────────────────────────────────────────

/** Delete events older than 30 days. Call periodically or on startup. */
export function cleanupOldEvents(db: Database.Database): number {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const result = db.prepare("DELETE FROM agent_events WHERE created_at < ?").run(cutoff);
  return result.changes;
}

// ─── File watcher ───────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null;
let callback: EventCallback | null = null;

/** Start watching for agent lifecycle events from hook scripts */
export function startNotifyHandler(onEvent: EventCallback): void {
  callback = onEvent;
  const dir = getEventsDir();

  try {
    watcher = watch(dir, (_eventType, filename) => {
      if (!filename?.endsWith(".json")) return;
      const filePath = join(dir, filename);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const event = JSON.parse(raw) as AgentEvent;
        if (event.type && event.agentId) {
          callback?.(event);
        }
      } catch {
        // Malformed event file — ignore
      }
      try {
        unlinkSync(filePath);
      } catch {
        /* already deleted or locked */
      }
    });
    logger.info("[NotifyHandler] Watching for agent lifecycle events");
  } catch (err) {
    logger.warn("[NotifyHandler] Failed to start event watcher:", err);
  }
}

/** Stop watching */
export function stopNotifyHandler(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  callback = null;
}
