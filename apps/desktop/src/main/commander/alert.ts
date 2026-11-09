import { Notification } from "electron";
import type Database from "libsql";
import { getAppSettings } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { ExegolToolError } from "../mcp/exegol-protocol";

const GAP_MS = 60_000;
const MAX_CHARS = 200;
let lastAt = 0;

/** A chime and a notice that the Commander has something for the person: one a minute.
 *  Not through the NotificationBus: its notice must be silent and open the Commander tab */
export function alertPerson(
  db: Database.Database,
  args: Record<string, unknown>,
  now = Date.now(),
) {
  const message = typeof args.message === "string" ? args.message.trim().slice(0, MAX_CHARS) : "";
  if (!message) throw new ExegolToolError("alert_person needs a message", -32602);
  if (now - lastAt < GAP_MS) {
    throw new ExegolToolError(
      "You called the person less than a minute ago: say it in the chat, they will read it there",
      -32010,
    );
  }
  lastAt = now;
  const enabled = getAppSettings(db).notificationsEnabled;
  broadcast("commander:alert", { message, sound: enabled });
  if (enabled) notify(message);
  return { alerted: true, note: "They heard a chime and saw your line. Say the rest in the chat." };
}

function notify(message: string): void {
  try {
    if (!Notification.isSupported()) return;
    // Silent: the window plays the chime, and two sounds would overlap
    const notification = new Notification({ title: "Commander", body: message, silent: true });
    notification.on("click", () => {
      void import("../bootstrap/window").then((m) => m.showMainWindowWith("commander:open"));
    });
    notification.show();
  } catch (err) {
    logger.warn("[Commander] notice not shown:", err);
  }
}

/** For tests */
export function resetAlertGap(): void {
  lastAt = 0;
}
