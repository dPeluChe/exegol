import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, clipboard, dialog, ipcMain, webContents } from "electron";
import { getAgentManager } from "../agents/manager";
import { getDb } from "../db/client";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { checkForUpdatesManual, installUpdate } from "../system/auto-updater";
import { getPtyHost } from "../terminal/pty-host";
import {
  consumeMissedOutput,
  forgetViewer,
  setTerminalViewerVisible,
} from "../terminal/pty-visibility";

/** webContents we already wired a destroy listener for. */
const trackedSenders = new Set<number>();

import { whenSessionReady } from "../terminal/reattach-gate";
import { getMainWindow } from "./window";

export function registerIpcHandlers(): void {
  // Terminal write: renderer -> main -> pty
  ipcMain.on("terminal:write", (_event, agentId: string, data: string) => {
    const manager = getAgentManager();
    manager.write(agentId, data);
  });

  // T196: renderer errors land in the log file (a packaged app has no console)
  ipcMain.on("log:renderer-error", (event, source: string, message: string, stack: string) => {
    logger.error(`[Renderer w${event.sender.id}] ${source}: ${message}\n${stack}`);
  });

  // App DevTools from the TitleBar (whichever window asked)
  ipcMain.on("app:toggle-devtools", (event) => {
    event.sender.toggleDevTools();
  });

  // Terminal resize: renderer -> main -> pty
  ipcMain.on("terminal:resize", (_event, agentId: string, cols: number, rows: number) => {
    const before = getPtyHost().getSize(agentId);
    // A drag re-sends the same grid every frame; each would be a sidecar RPC
    if (before?.cols === cols && before?.rows === rows) return;
    getAgentManager().resize(agentId, cols, rows);
    // Remembered so a reattach rebuilds the model at the size the output was drawn at
    try {
      getDb()
        .prepare("UPDATE agents SET pty_cols = ?, pty_rows = ? WHERE id = ?")
        .run(cols, rows, agentId);
    } catch {
      /* not an agent row (or db closing): the default size is only a fallback */
    }
    // Overview mirrors follow the owner's size; they never resize the PTY themselves
    if (before) broadcast("terminal:resized", agentId, cols, rows);
  });

  // Repaint without telling mirrors: the jiggle is not a real size change
  ipcMain.on("terminal:redraw", (_event, agentId: string) => {
    getPtyHost().redraw(agentId);
  });

  ipcMain.on("terminal:clear", (_event, agentId: string) => {
    getPtyHost().clear(agentId);
  });

  // A mirror sizes itself from this before its snapshot: before the reattach there is no size yet
  ipcMain.handle("terminal:get-size", async (_event, agentId: string) => {
    await whenSessionReady(agentId);
    return getPtyHost().getSize(agentId);
  });

  // Terminal snapshot: replay ring buffer content for late-mounting terminals
  // A pane mounted during startup asked before its session was reattached and got nothing: an
  // idle TUI (claude at its prompt) then stayed blank until touched. Wait for ITS reattach only
  ipcMain.handle("terminal:get-snapshot", async (_event, agentId: string) => {
    await whenSessionReady(agentId);
    return getPtyHost().getLiveSnapshot(agentId);
  });

  // A mount only needs to know whether output exists: serializing it just to test length cost 25-40ms
  ipcMain.handle("terminal:has-content", async (_event, agentId: string) => {
    await whenSessionReady(agentId);
    return getPtyHost().hasContent(agentId);
  });

  /** T178: a view reports whether it can currently draw this agent. Returns a
   *  snapshot when output was dropped while hidden, so the view repaints from
   *  the model instead of resuming mid-stream on a screen that moved on. */
  ipcMain.handle(
    "terminal:set-visible",
    (event, agentId: string, visible: boolean, viewId: string, fresh?: boolean) => {
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
      setTerminalViewerVisible(agentId, viewerId, visible, viewId);
      // A view's first report comes from a mount that fetched its own snapshot:
      // repainting it again would serialize and paint the screen twice
      if (!visible || !consumeMissedOutput(agentId) || fresh) return;
      const snapshot = getPtyHost().getLiveSnapshot(agentId);
      if (!snapshot) return;
      // Pushed through terminal:data rather than returned, so the repaint is
      // ORDERED with live output. Returning it raced: bytes arriving between the
      // gate opening and the reply landing were applied, then wiped by the
      // renderer's reset. RIS (ESC c) makes the reset part of the same stream.
      broadcast("terminal:data", agentId, `\x1bc${snapshot}`);
    },
  );

  // Save clipboard image as temp file for terminal paste
  ipcMain.handle("terminal:save-clipboard-image", async () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
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

  /** The pane's own webview (by id, and only one hosted by the sender window); without an id,
   *  the window's first. The first-only lookup hit the wrong page with two browser panes */
  const findWebview = (sender: Electron.WebContents, id?: number) => {
    const isOurs = (wc: Electron.WebContents | undefined) =>
      !!wc && wc.getType() === "webview" && wc.hostWebContents === sender;
    if (id !== undefined) {
      const wc = webContents.fromId(id);
      return isOurs(wc) ? wc : undefined;
    }
    return webContents.getAllWebContents().find(isOurs);
  };

  // Inject JS into the webview and return the result
  ipcMain.handle(
    "browser:execute-js",
    async (_event, { code, webContentsId }: { code: string; webContentsId?: number }) => {
      const wv = findWebview(_event.sender, webContentsId);
      if (!wv) return null;
      return wv.executeJavaScript(code);
    },
  );

  // Capture the webview as a base64 PNG screenshot
  ipcMain.handle(
    "browser:capture-screenshot",
    async (_event, args?: { webContentsId?: number }) => {
      const wv = findWebview(_event.sender, args?.webContentsId);
      if (!wv) return null;
      const image = await wv.capturePage();
      return image.toPNG().toString("base64");
    },
  );
}
