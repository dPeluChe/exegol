import type { WebContents } from "electron";

/** A page in a browser pane would take Ctrl+Tab and the Ctrl release: the switcher needs both */
export function forwardSwitcherKeys(contents: WebContents): void {
  contents.on("before-input-event", (event, input) => {
    const host = contents.hostWebContents;
    if (!host || host.isDestroyed()) return;
    if (input.type === "keyDown" && input.key === "Tab" && input.control && !input.meta) {
      event.preventDefault();
      host.send("pane-switcher:key", { kind: "tab", shift: input.shift });
    } else if (input.type === "keyUp" && input.key === "Control") {
      host.send("pane-switcher:key", { kind: "release" });
    }
  });
}
