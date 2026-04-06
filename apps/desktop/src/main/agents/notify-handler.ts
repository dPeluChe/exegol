// Agent lifecycle event system — watches ~/.exegol/events/ for hook-generated events.

import { type FSWatcher, readFileSync, unlinkSync, watch } from "node:fs";
import { join } from "node:path";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { getEventsDir } from "./wrappers";

// ─── Structured event types ────────────────────────────────────────────────

export type AgentEventType =
  | "task_complete"
  | "task_failed"
  | "permission_needed"
  | "token_limit"
  | "tool_use"
  | "prompt_submit"
  | "session_start"
  | "stop";

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  ts: number;
  payload?: Record<string, unknown>;
}

export type EventCallback = (event: AgentEvent) => void;

// ─── Event log persistence ──────────────────────────────────────────────────

export function logAgentEvent(db: Database.Database, event: AgentEvent): void {
  try {
    db.prepare(
      "INSERT INTO agent_events (agent_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
    ).run(event.agentId, event.type, JSON.stringify(event.payload ?? {}), event.ts);
  } catch {
    // Non-fatal: event logging is best-effort
  }
}

export function getAgentEvents(db: Database.Database, agentId: string, limit = 50): AgentEvent[] {
  const rows = db
    .prepare(
      "SELECT type, agent_id, payload, created_at FROM agent_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(agentId, limit) as Array<{
    type: string;
    agent_id: string;
    payload: string;
    created_at: number;
  }>;

  return rows.map((r) => ({
    type: r.type as AgentEventType,
    agentId: r.agent_id,
    ts: r.created_at,
    payload: JSON.parse(r.payload || "{}"),
  }));
}

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

/** Emit an event programmatically (from agent lifecycle callbacks) */
export function emitAgentEvent(event: AgentEvent): void {
  callback?.(event);
}

/** Stop watching */
export function stopNotifyHandler(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  callback = null;
}
