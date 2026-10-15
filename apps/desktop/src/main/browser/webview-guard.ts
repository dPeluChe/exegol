import { type WebContents, webContents } from "electron";

/** A page in a browser pane (a webview), not an app window */
export const isPage = (wc: WebContents | null | undefined): wc is WebContents =>
  !!wc && !wc.isDestroyed() && wc.getType() === "webview";

/** The pending item's webview, when the asking window hosts it */
export function hostedBy(sender: WebContents, item: { wcId: number } | undefined) {
  const wc = item ? webContents.fromId(item.wcId) : undefined;
  return wc && !wc.isDestroyed() && wc.hostWebContents === sender ? wc : null;
}

export function sendTo(host: WebContents | null, channel: string, payload: unknown): void {
  if (host && !host.isDestroyed()) host.send(channel, payload);
}
