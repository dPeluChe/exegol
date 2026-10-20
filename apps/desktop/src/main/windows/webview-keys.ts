import { BrowserWindow, type WebContents } from "electron";
import { webviewAppKey } from "./app-keys";
import { runAppKey } from "./app-menu";

/** A page in a browser pane would take Ctrl+Tab and the Ctrl release (the switcher needs both)
 *  and, off macOS, the app chords the macOS menu takes from it (app-keys) */
export function forwardWebviewKeys(contents: WebContents): void {
  let armed = false;
  contents.on("before-input-event", (event, input) => {
    const host = contents.hostWebContents;
    if (!host || host.isDestroyed()) return;
    if (input.type === "keyDown" && input.key === "Tab" && input.control && !input.meta) {
      event.preventDefault();
      armed = true;
      host.send("pane-switcher:key", { kind: "tab", shift: input.shift });
      return;
    }
    if (armed && input.type === "keyUp" && input.key === "Control") {
      armed = false;
      host.send("pane-switcher:key", { kind: "release" });
      return;
    }
    const action = webviewAppKey(input, process.platform);
    const win = action && BrowserWindow.fromWebContents(host);
    if (!action || !win) return;
    event.preventDefault();
    if (!input.isAutoRepeat) runAppKey(action, win);
  });
}
