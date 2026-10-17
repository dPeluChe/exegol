import { paneZoomKey } from "@exegol/shared";
import type { WebContents } from "electron";

/** Cmd+= / Cmd+- / Cmd+0 with a pane's page focused zoom that page: the host window never sees
 *  the keys, and the app menu would zoom all of Exegol. preventDefault also stops the menu */
export function forwardPaneZoomKeys(
  contents: WebContents,
  paneOf: (wcId: number) => string | undefined,
): void {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const action = paneZoomKey(input, process.platform === "darwin");
    if (!action) return;
    const host = contents.hostWebContents;
    const paneId = paneOf(contents.id);
    // A floating window's page has no zoom controls: the app menu keeps its keys there
    if (!paneId || !host || host.isDestroyed() || host.getURL().includes("floatingPane=")) return;
    event.preventDefault();
    host.send("browser:zoom-key", { paneId, action });
  });
}
