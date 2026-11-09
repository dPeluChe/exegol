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

interface FloatingPaneConfig {
  /** Stable id used by the renderer workspace store */
  paneId: string;
  /** Content kind; "chat" is a session's chat and takes over no pane */
  type: "terminal" | "browser" | "chat";
  /** Display title shown in the floating window titlebar */
  title: string;
  /** For terminal: the agent whose PTY we bind to */
  agentId?: string;
  /** For browser: the URL to load inside the webview */
  url?: string;
  /** For browser: project id used to look up running agents for send-to-agent */
  projectId?: string;
  /** For browser: the device size the pane showed the page at, "1440x900" */
  viewport?: string;
  /** Opened for an agent: shown without taking the focus from what the user is doing */
  inactive?: boolean;
}

const floatingWindows = new Map<string, BrowserWindow>();
const chatAgents = new Map<string, string | undefined>();
/** Pending "floating:closed" notifications buffered until renderer attaches listener, with the
 *  page a floating browser was last on (the pane goes back to it, not to where it floated from) */
const pendingClosedEvents = new Map<string, string | undefined>();
const lastPages = new Map<string, string>();
let mainWindowRef: BrowserWindow | null = null;

export function registerMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
  // On main window load, flush any queued close events so the renderer's
  // workspace store can clean up after a previous crash or reload.
  win.webContents.on("did-finish-load", () => {
    if (pendingClosedEvents.size === 0) return;
    for (const [paneId, page] of pendingClosedEvents) {
      win.webContents.send("floating:closed", paneId, page);
    }
    pendingClosedEvents.clear();
  });
}

function notifyMainWindowClosed(paneId: string): void {
  const page = lastPages.get(paneId);
  lastPages.delete(paneId);
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("floating:closed", paneId, page);
  } else {
    pendingClosedEvents.set(paneId, page);
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
  if (config.projectId) params.set("floatingProjectId", config.projectId);
  if (config.viewport) params.set("floatingViewport", config.viewport);
  const query = params.toString();
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}?${query}`;
  }
  return `file://${join(__dirname, "../renderer/index.html")}?${query}`;
}

const SIZES: Record<
  FloatingPaneConfig["type"],
  { width: number; height: number; minHeight: number }
> = {
  terminal: { width: 720, height: 420, minHeight: 200 },
  browser: { width: 900, height: 620, minHeight: 200 },
  chat: { width: 420, height: 560, minHeight: 300 },
};

function openFloatingPane(config: FloatingPaneConfig): void {
  // If already floating, focus it instead of opening a duplicate
  const existing = floatingWindows.get(config.paneId);
  if (existing && !existing.isDestroyed()) {
    // The same chat window follows a session that was started again
    if (config.type === "chat" && chatAgents.get(config.paneId) !== config.agentId) {
      chatAgents.set(config.paneId, config.agentId);
      void existing.loadURL(buildUrl(config));
    }
    existing.focus();
    return;
  }

  const size = SIZES[config.type];
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 320,
    minHeight: size.minHeight,
    show: false,
    alwaysOnTop: true,
    frame: false,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 12, y: 12 } }
      : {}),
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
  win.on("ready-to-show", () => (config.inactive ? win.showInactive() : win.show()));

  win.on("closed", () => {
    floatingWindows.delete(config.paneId);
    chatAgents.delete(config.paneId);
    if (config.type !== "chat") notifyMainWindowClosed(config.paneId);
  });

  win.loadURL(buildUrl(config));
  floatingWindows.set(config.paneId, win);
  if (config.type === "chat") chatAgents.set(config.paneId, config.agentId);
}

function closeFloatingPane(paneId: string): void {
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
  // A floating browser reports the page it is on; its pane reopens there when it docks back
  ipcMain.on("floating:page", (event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    for (const [paneId, win] of floatingWindows) {
      if (!win.isDestroyed() && win.webContents === event.sender) lastPages.set(paneId, url);
    }
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
