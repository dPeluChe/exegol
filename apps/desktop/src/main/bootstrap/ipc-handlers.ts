import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, clipboard, dialog, ipcMain, webContents } from "electron";
import { getAgentManager } from "../agents/manager";
import { isHostedWebview } from "../browser/electron-host";
import { savePaneScreenshot } from "../browser/screenshot";
import { broadcast } from "../lib/event-bus";
import { suppressedNote } from "../lib/log-limiter";
import { logger } from "../lib/logger";
import { checkForUpdatesManual, installUpdate } from "../system/auto-updater";
import {
  AGENT_ID,
  formatMountLine,
  mountLogKey,
  mountLogLimit,
  mountLogWarns,
  parseMountStats,
  visibleLogLimit,
} from "../terminal/mount-log";
import { getPtyHost } from "../terminal/pty-host";
import {
  consumeMissedOutput,
  forgetViewer,
  hasVisibleViewer,
  setTerminalViewerVisible,
} from "../terminal/pty-visibility";
import { whenSessionReady } from "../terminal/reattach-gate";
import { requestPtyResize } from "../terminal/resize-request";
import { popupAppMenu, zoomWindow } from "../windows/app-menu";
import { getMainWindow } from "./window";

/** webContents we already wired a destroy listener for. */
const trackedSenders = new Set<number>();

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

  // Linux/Windows app keys (no menu bar): zoom the asking window's UI, quit
  ipcMain.on("app:zoom", (event, action: unknown) => {
    if (action === "in" || action === "out" || action === "reset") zoomWindow(event.sender, action);
  });
  ipcMain.on("app:quit", () => app.quit());

  // Terminal resize: renderer -> main -> pty
  ipcMain.on("terminal:resize", (_event, agentId: string, cols: number, rows: number) => {
    requestPtyResize(agentId, cols, rows);
  });

  // No terminal:resized broadcast: the jiggle is not a real size change
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
    return getPtyHost().parsedLiveSnapshot(agentId);
  });

  // Sizes, counts and times of a view's mount (renderer/terminal-setup): never content
  ipcMain.on("terminal:mount-log", (_event, agentId: unknown, input: unknown) => {
    const mount = parseMountStats(agentId, input);
    if (!mount) return;
    const suppressed = mountLogLimit.take(mountLogKey(mount), Date.now());
    if (suppressed === null) return;
    const line = `${formatMountLine(mount)}${suppressedNote(suppressed)}`;
    if (mountLogWarns(mount)) logger.warn(line);
    else logger.info(line);
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
    async (event, agentId: unknown, visible: boolean, viewId: string, fresh?: boolean) => {
      if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return;
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
      const wasVisible = hasVisibleViewer(agentId);
      setTerminalViewerVisible(agentId, viewerId, visible, viewId);
      const nowVisible = hasVisibleViewer(agentId);
      if (wasVisible !== nowVisible) {
        const suppressed = visibleLogLimit.take(agentId, Date.now());
        if (suppressed !== null) {
          logger.info(
            `[Visible] ${agentId} ${nowVisible ? "on" : "off"}${suppressedNote(suppressed)}`,
          );
        }
      }
      // A view's first report comes from a mount that fetched its own snapshot:
      // repainting it again would serialize and paint the screen twice
      if (!visible || !consumeMissedOutput(agentId) || fresh) return;
      await whenSessionReady(agentId);
      // The gate is open already: output during the wait reaches the view AND is in this
      // snapshot (taken once parsed), so the reset below repaints it instead of losing it
      const snapshot = await getPtyHost().parsedLiveSnapshot(agentId);
      if (!snapshot?.data) return;
      // Pushed through terminal:data rather than returned, so the repaint is
      // ORDERED with live output. Returning it raced: bytes arriving between the
      // gate opening and the reply landing were applied, then wiped by the
      // renderer's reset. RIS (ESC c) makes the reset part of the same stream.
      broadcast("terminal:data", agentId, `\x1bc${snapshot.data}`, snapshot.seq);
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
  ipcMain.on("window:app-menu", (event, x: unknown, y: unknown) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents) return;
    if (typeof x !== "number" || typeof y !== "number") return;
    popupAppMenu(win, x, y);
  });

  // ── T102: Design Mode + QA — browser pane IPC ──────────────────────

  /** The pane's own webview (by id, and only one hosted by the sender window); without an id,
   *  the window's first. The first-only lookup hit the wrong page with two browser panes */
  const findWebview = (sender: Electron.WebContents, id?: number) => {
    if (id !== undefined) {
      const wc = webContents.fromId(id);
      return isHostedWebview(wc, sender) ? wc : undefined;
    }
    return webContents.getAllWebContents().find((wc) => isHostedWebview(wc, sender));
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

  // The user's own Save Screenshot (camera button): a file they pick, or the clipboard
  ipcMain.handle(
    "browser:save-screenshot",
    async (event, args?: { webContentsId?: unknown; target?: unknown; fullPage?: unknown }) => {
      if (typeof args?.webContentsId !== "number") return "failed";
      const wv = findWebview(event.sender, args.webContentsId);
      if (!wv) return "failed";
      return savePaneScreenshot(wv, event.sender, {
        target: args.target === "clipboard" ? "clipboard" : "file",
        fullPage: args.fullPage === true,
      });
    },
  );
}
