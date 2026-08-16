import { app, dialog, ipcMain, webContents } from "electron";
import { getAgentManager } from "../agents/manager";
import { checkForUpdatesManual, installUpdate } from "../system/auto-updater";
import { getPtyHost } from "../terminal/pty-host";
import {
  consumeMissedOutput,
  forgetViewer,
  setTerminalViewerVisible,
} from "../terminal/pty-visibility";

/** webContents we already wired a destroy listener for. */
const trackedSenders = new Set<number>();

import { getMainWindow } from "./window";

export function registerIpcHandlers(): void {
  // Terminal write: renderer -> main -> pty
  ipcMain.on("terminal:write", (_event, agentId: string, data: string) => {
    const manager = getAgentManager();
    manager.write(agentId, data);
  });

  // App DevTools from the TitleBar (whichever window asked)
  ipcMain.on("app:toggle-devtools", (event) => {
    event.sender.toggleDevTools();
  });

  // Terminal resize: renderer -> main -> pty
  ipcMain.on("terminal:resize", (_event, agentId: string, cols: number, rows: number) => {
    const manager = getAgentManager();
    manager.resize(agentId, cols, rows);
  });

  // Terminal snapshot: replay ring buffer content for late-mounting terminals
  ipcMain.handle("terminal:get-snapshot", (_event, agentId: string) => {
    return getPtyHost().getSnapshot(agentId);
  });

  /** T178: a view reports whether it can currently draw this agent. Returns a
   *  snapshot when output was dropped while hidden, so the view repaints from
   *  the model instead of resuming mid-stream on a screen that moved on. */
  ipcMain.handle("terminal:set-visible", (event, agentId: string, visible: boolean) => {
    const viewerId = event.sender.id;
    if (!trackedSenders.has(viewerId)) {
      trackedSenders.add(viewerId);
      // A reload or a closed window never sends "hidden" for anything it was
      // showing. Without this the gate degrades to a no-op after one Cmd+R.
      event.sender.once("destroyed", () => {
        trackedSenders.delete(viewerId);
        forgetViewer(viewerId);
      });
    }
    setTerminalViewerVisible(agentId, viewerId, visible);
    if (!visible || !consumeMissedOutput(agentId)) return null;
    return getPtyHost().getSnapshot(agentId);
  });

  // Save clipboard image as temp file for terminal paste
  ipcMain.handle("terminal:save-clipboard-image", async () => {
    const { clipboard } = await import("electron");
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const name = `exegol-paste-${Date.now()}.png`;
    const filePath = join(tmpdir(), name);
    await writeFile(filePath, img.toPNG());
    return filePath;
  });

  // App version
  ipcMain.handle("app:version", () => {
    return app.getVersion();
  });

  // Dialog: open folder picker
  ipcMain.handle("dialog:showOpenDialog", async (_event, options) => {
    return dialog.showOpenDialog(options);
  });

  // Auto-updater controls (T44)
  ipcMain.handle("updater:check", () => {
    checkForUpdatesManual();
  });
  ipcMain.handle("updater:install", () => {
    installUpdate();
  });

  // Window controls
  ipcMain.on("window:minimize", () => {
    getMainWindow()?.minimize();
  });
  ipcMain.on("window:maximize", () => {
    const mainWindow = getMainWindow();
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on("window:close", () => {
    getMainWindow()?.close();
  });

  // ── T102: Design Mode + QA — browser pane IPC ──────────────────────

  /** Find the first <webview> webContents hosted by the sender window. */
  const findWebview = (sender: Electron.WebContents) =>
    webContents
      .getAllWebContents()
      .find((wc) => wc.getType() === "webview" && wc.hostWebContents === sender);

  // Inject JS into the webview and return the result
  ipcMain.handle("browser:execute-js", async (_event, { code }: { code: string }) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    return wv.executeJavaScript(code);
  });

  // Capture the webview as a base64 PNG screenshot
  ipcMain.handle("browser:capture-screenshot", async (_event) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    const image = await wv.capturePage();
    return image.toPNG().toString("base64");
  });

  // Capture a specific element's geometry + computed styles
  ipcMain.handle("browser:capture-element", async (_event, { selector }: { selector: string }) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    return wv.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const styles = getComputedStyle(el);
        return {
          selector: ${JSON.stringify(selector)},
          tagName: el.tagName.toLowerCase(),
          text: el.textContent?.slice(0, 200) ?? "",
          html: el.outerHTML.slice(0, 1000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: {
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            padding: styles.padding,
            margin: styles.margin,
          },
        };
      })()
    `);
  });
}
