import { resolve } from "node:path";
import type { CaptureLink } from "@exegol/shared";
import { app, type BrowserWindow } from "electron";
import { findDeepLinkArg, parseCaptureLink, parseDeepLink } from "../lib/deeplink";
import { logger } from "../lib/logger";
import { createWindow, getMainWindow, showMainWindow } from "./window";

// ─── T155.6: exegol:// deep link (CLI opener) ─────────────────────────────

let pendingDeepLinkPath: string | null = null;
let pendingCapture: CaptureLink | null = null;

export function deliverPendingDeepLink(win: BrowserWindow): void {
  if (pendingDeepLinkPath) {
    win.webContents.send("deeplink:open-path", { path: pendingDeepLinkPath });
    pendingDeepLinkPath = null;
  }
  if (pendingCapture) {
    win.webContents.send("deeplink:capture", pendingCapture);
    pendingCapture = null;
  }
}

function handleDeepLinkUrl(url: string): void {
  const capture = parseCaptureLink(url);
  const parsed = capture ? null : parseDeepLink(url);
  if (capture) {
    // A capture carries what the person sent: only its shape is logged
    logger.info(`[DeepLink] capture${capture.url ? " url" : ""}${capture.text ? " text" : ""}`);
    pendingCapture = capture;
  } else if (parsed) {
    logger.info("[DeepLink] open path");
    pendingDeepLinkPath = parsed.path;
  } else {
    logger.warn("[DeepLink] Ignored a malformed link");
    return;
  }

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
