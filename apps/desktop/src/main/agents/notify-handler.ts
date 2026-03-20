// Lifecycle event handler — watches ~/.exegol/events/ for agent notification files.
// Events are created by hooks (notify.sh) and consumed here.

import { type FSWatcher, readFileSync, unlinkSync, watch } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { getEventsDir } from "./wrappers";

interface AgentEvent {
  type: string;
  agentId: string;
  ts: number;
}

type EventCallback = (event: AgentEvent) => void;

let watcher: FSWatcher | null = null;
let callback: EventCallback | null = null;

/** Start watching for agent lifecycle events */
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
      // Clean up processed event file
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
