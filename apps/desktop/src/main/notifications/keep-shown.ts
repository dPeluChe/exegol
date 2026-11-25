import type { Notification } from "electron";

const KEPT = 30;
const shown: Notification[] = [];

/** Shows a notification and holds the last few: a collected one loses its click handler, while
 *  Windows and macOS keep it in their notification list. Not dropped on close, which macOS skips
 *  for a banner that times out and Windows may send as the toast moves to the Action Center */
export function showKept(notification: Notification): void {
  shown.push(notification);
  if (shown.length > KEPT) shown.shift();
  const drop = () => {
    const at = shown.indexOf(notification);
    if (at >= 0) shown.splice(at, 1);
  };
  notification.on("click", drop);
  notification.on("failed", drop);
  notification.show();
}
