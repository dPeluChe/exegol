/**
 * Floating pane windows (T84 Picture-in-Picture).
 *
 * A floating pane is a small always-on-top BrowserWindow that hosts the
 * same TerminalInstance or browser content as a pane in the main window.
 * When the floating window closes, we notify the main window's renderer
 * so it can "unfloat" the pane and return to inline display.
 */

import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, ipcMain, webContents } from "electron";

export interface FloatingPaneConfig {
  /** Stable id used by the renderer workspace store */
  paneId: string;
  /** Content kind */
  type: "terminal" | "browser";
  /** Display title shown in the floating window titlebar */
  title: string;
  /** For terminal: the agent whose PTY we bind to */
  agentId?: string;
  /** For browser: the URL to load inside the webview */
  url?: string;
}

const floatingWindows = new Map<string, BrowserWindow>();
/** Pending "floating:closed" notifications buffered until renderer attaches listener. */
const pendingClosedEvents = new Set<string>();
let mainWindowRef: BrowserWindow | null = null;

export function registerMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
  // On main window load, flush any queued close events so the renderer's
  // workspace store can clean up after a previous crash or reload.
  win.webContents.on("did-finish-load", () => {
    if (pendingClosedEvents.size === 0) return;
    for (const paneId of pendingClosedEvents) {
      win.webContents.send("floating:closed", paneId);
    }
    pendingClosedEvents.clear();
  });
}

function notifyMainWindowClosed(paneId: string): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("floating:closed", paneId);
  } else {
    pendingClosedEvents.add(paneId);
  }
}

function buildUrl(config: FloatingPaneConfig): string {
  const params = new URLSearchParams({
    floatingPane: config.paneId,
    floatingType: config.type,
    floatingTitle: config.title,
  });
  if (config.agentId) params.set("floatingAgentId", config.agentId);
  if (config.url) params.set("floatingUrl", config.url);
  const query = params.toString();
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}?${query}`;
  }
  return `file://${join(__dirname, "../renderer/index.html")}?${query}`;
}

export function openFloatingPane(config: FloatingPaneConfig): void {
  // If already floating, focus it instead of opening a duplicate
  const existing = floatingWindows.get(config.paneId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: config.type === "terminal" ? 720 : 900,
    height: config.type === "terminal" ? 420 : 620,
    minWidth: 320,
    minHeight: 200,
    show: false,
    alwaysOnTop: true,
    frame: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: "#0a0a0b",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.setAlwaysOnTop(true, "floating");
  win.on("ready-to-show", () => win.show());

  win.on("closed", () => {
    floatingWindows.delete(config.paneId);
    notifyMainWindowClosed(config.paneId);
  });

  win.loadURL(buildUrl(config));
  floatingWindows.set(config.paneId, win);
}

export function closeFloatingPane(paneId: string): void {
  const win = floatingWindows.get(paneId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
}

export function closeAllFloatingPanes(): void {
  for (const win of floatingWindows.values()) {
    if (!win.isDestroyed()) win.close();
  }
  floatingWindows.clear();
}

export function registerFloatingIpcHandlers(): void {
  ipcMain.handle("floating:open", (_event, config: FloatingPaneConfig) => {
    openFloatingPane(config);
  });
  ipcMain.handle("floating:close", (_event, paneId: string) => {
    closeFloatingPane(paneId);
  });
  // Window controls for floating windows (they're frameless)
  ipcMain.on("floating:self-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  // DevTools toggle for floating browser panes. We must target the embedded
  // <webview>'s webContents (not the host React shell) and work around two
  // Electron quirks:
  //   1. A detached DevTools window is NOT always-on-top, so it gets hidden
  //      behind the floating window. We temporarily drop the floating
  //      window's always-on-top flag while DevTools is open, then restore
  //      it via the `devtools-closed` event.
  //   2. The webview's webContents is not directly reachable from the host
  //      window; we find it via `hostWebContents === event.sender`.
  ipcMain.on("floating:self-devtools", (event) => {
    const hostWin = BrowserWindow.fromWebContents(event.sender);
    if (!hostWin) return;
    const webviewContents = webContents
      .getAllWebContents()
      .find((wc) => wc.getType() === "webview" && wc.hostWebContents === event.sender);
    const target = webviewContents ?? event.sender;
    if (target.isDevToolsOpened()) {
      target.closeDevTools();
      return;
    }
    target.openDevTools({ mode: "detach" });
    hostWin.setAlwaysOnTop(false);
    const restore = () => {
      if (!hostWin.isDestroyed()) hostWin.setAlwaysOnTop(true, "floating");
    };
    target.once("devtools-closed", restore);
  });
}
