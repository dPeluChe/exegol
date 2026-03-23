import { DEFAULT_SETTINGS } from "@exegol/shared";
import { BrowserWindow, Notification } from "electron";
import type Database from "libsql";
import type { AgentStatusEvent } from "../agents/spawn-env";
import { logger } from "../lib/logger";

// ─── Settings cache (avoid DB hits on every status change) ──────────────

let cachedEnabled: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

function isNotificationsEnabled(db: Database.Database): boolean {
  const now = Date.now();
  if (cachedEnabled !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEnabled;
  }

  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      cachedEnabled = DEFAULT_SETTINGS.notificationsEnabled;
    } else {
      const parsed = JSON.parse(row.value);
      cachedEnabled = parsed.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled;
    }
  } catch {
    cachedEnabled = DEFAULT_SETTINGS.notificationsEnabled;
  }

  cacheTimestamp = now;
  return cachedEnabled ?? true;
}

// ─── Notification display ───────────────────────────────────────────────

const NOTIFIABLE_STATUSES = new Set(["completed", "failed", "crashed", "waiting_input"]);

const STATUS_LABELS: Record<string, string> = {
  completed: "completed",
  failed: "failed",
  crashed: "crashed",
  waiting_input: "waiting for input",
};

/**
 * Show a system notification for an agent status change.
 * Skips if disabled, if the agent is a shell, or if the status is not terminal/actionable.
 */
export function showAgentNotification(event: AgentStatusEvent, db: Database.Database): void {
  try {
    if (!Notification.isSupported()) return;
    if (event.cliType === "shell") return;
    if (!NOTIFIABLE_STATUSES.has(event.status)) return;
    if (!isNotificationsEnabled(db)) return;

    // Get task description from DB for the notification body
    let body = "";
    try {
      const row = db
        .prepare("SELECT task_description FROM agents WHERE id = ?")
        .get(event.agentId) as { task_description: string } | undefined;
      if (row?.task_description) {
        body =
          row.task_description.length > 100
            ? `${row.task_description.slice(0, 97)}...`
            : row.task_description;
      }
    } catch {
      // Non-fatal: notification still works without body
    }

    const statusLabel = STATUS_LABELS[event.status] ?? event.status;
    const notification = new Notification({
      title: `Agent ${statusLabel}`,
      body: body || `${event.cliType} agent ${statusLabel}`,
      silent: false,
    });

    notification.on("click", () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.show();
        win.focus();
        win.webContents.send("notification:navigate", { agentId: event.agentId });
      }
    });

    notification.show();
  } catch (err) {
    logger.warn("[Notifications] Failed to show notification:", err);
  }
}
