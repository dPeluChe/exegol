import type { NotificationEvent } from "@exegol/shared";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { BrowserWindow, Notification } from "electron";
import type Database from "libsql";
import { logger } from "../../lib/logger";
import type { NotificationChannel } from "../bus";

// ─── Settings cache (avoid a DB hit on every event) ──────────────────────

let dbRef: Database.Database | null = null;
let cachedEnabled: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/** Called once at app bootstrap so the channel can read the notificationsEnabled setting. */
export function setDesktopChannelDb(db: Database.Database): void {
  dbRef = db;
}

function isEnabled(): boolean {
  const now = Date.now();
  if (cachedEnabled !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEnabled;
  }
  try {
    const row = dbRef?.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
      | { value: string }
      | undefined;
    cachedEnabled = row
      ? (JSON.parse(row.value).notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled)
      : DEFAULT_SETTINGS.notificationsEnabled;
  } catch {
    cachedEnabled = DEFAULT_SETTINGS.notificationsEnabled;
  }
  cacheTimestamp = now;
  return cachedEnabled ?? true;
}

/**
 * Desktop channel: Electron Notification API. Registered by default on
 * `getNotificationBus()` — settings/quiet-mode toggles land in a later pass
 * (needs settings.ts schema + UI, outside WT-A's write set); this ships the
 * existing global `notificationsEnabled` gate.
 */
export const desktopChannel: NotificationChannel = {
  id: "desktop",
  deliver(event: NotificationEvent): void {
    try {
      if (!Notification.isSupported()) return;
      if (!isEnabled()) return;
      // Suppress-empty pattern (openclaw `shouldSkipHeartbeatOnlyDelivery`):
      // never show a blank notification.
      if (!event.title?.trim() && !event.body?.trim()) return;

      const notification = new Notification({
        title: event.title || "Exegol",
        body: event.body || "",
        silent: false,
      });

      notification.on("click", () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.show();
        win.focus();
        if (event.agentId) {
          win.webContents.send("notification:navigate", { agentId: event.agentId });
        }
      });

      notification.show();
    } catch (err) {
      logger.warn("[NotificationBus] desktop channel failed to deliver:", err);
    }
  },
};
