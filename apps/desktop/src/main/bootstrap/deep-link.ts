import { resolve } from "node:path";
import { app, type BrowserWindow } from "electron";
import { findDeepLinkArg, parseDeepLink } from "../lib/deeplink";
import { logger } from "../lib/logger";
import { createWindow, getMainWindow, showMainWindow } from "./window";

// ─── T155.6: exegol:// deep link (CLI opener) ─────────────────────────────

let pendingDeepLinkPath: string | null = null;

export function deliverPendingDeepLink(win: BrowserWindow): void {
  if (!pendingDeepLinkPath) return;
  const path = pendingDeepLinkPath;
  pendingDeepLinkPath = null;
  win.webContents.send("deeplink:open-path", { path });
}

function handleDeepLinkUrl(url: string): void {
  const parsed = parseDeepLink(url);
  if (!parsed) {
    logger.warn(`[DeepLink] Ignored malformed url: ${url}`);
    return;
  }
  logger.info(`[DeepLink] open path: ${parsed.path}`);
  pendingDeepLinkPath = parsed.path;

  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    // Cold start (whenReady creates the window and flushes on load) or
    // tray-only mode — recreate the window; did-finish-load delivers.
    if (app.isReady()) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (win.webContents.isLoading()) return; // did-finish-load flushes
  deliverPendingDeepLink(win);
}

function registerDeepLinkProtocol(): void {
  // Dev mode on macOS/Windows: without execPath + entry args the OS silently
  // refuses to register the unpackaged Electron binary for the scheme.
  const entryArg = process.argv[1];
  if (process.defaultApp) {
    if (entryArg) {
      app.setAsDefaultProtocolClient("exegol", process.execPath, [resolve(entryArg)]);
    }
  } else {
    app.setAsDefaultProtocolClient("exegol");
  }
}

/** False when this is a second packaged copy, which is exiting */
export function installDeepLinkHandling(): boolean {
  // T155.6: single-instance — a second launch (e.g. Windows/Linux deep link)
  // forwards its argv here and exits; macOS delivers URLs via open-url instead.
  // Dev instances share userData with packaged ones, so only a packaged app
  // hard-quits when it loses the lock.
  if (app.requestSingleInstanceLock()) {
    // The window may have been closed into the tray (often invisible on Linux): reopen it
    app.on("second-instance", (_event, argv) => {
      if (app.isReady()) showMainWindow();
      const url = findDeepLinkArg(argv);
      if (url) handleDeepLinkUrl(url);
    });
  } else if (app.isPackaged) {
    // quit() is async: ready still fired and the copy grabbed the hotkey and MCP socket
    app.exit(0);
    return false;
  }

  // Must be registered before app ready — macOS can deliver the URL at launch.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });
  registerDeepLinkProtocol();
  // Linux/Windows cold start: the URL is in this first instance's own argv, never in
  // second-instance; it waits as pending until the window loads
  const coldUrl = findDeepLinkArg(process.argv);
  if (coldUrl) handleDeepLinkUrl(coldUrl);
  return true;
}
