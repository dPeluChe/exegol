/**
 * Settings window (T120).
 *
 * Settings used to be an in-app view; now it lives in its own BrowserWindow so
 * users can keep an eye on agent output while tweaking config. Intentionally
 * does NOT use `parent:` (would inherit minimize/hide with main on macOS) and
 * does NOT use alwaysOnTop (anti-pattern noted in the Terax review). Lifecycle
 * is bound manually via mainWindow.on("closed").
 */

import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, ipcMain } from "electron";

export type SettingsTab = "general" | "clis" | "terminal" | "shortcuts" | "apikeys";

let settingsWindow: BrowserWindow | null = null;

export function registerMainWindowForSettings(win: BrowserWindow): void {
  // T120: bind lifecycle without using BrowserWindow `parent:` — on macOS a
  // parented child window minimizes/hides with the parent, which defeats the
  // "watch agent output while tweaking config" goal of moving Settings out
  // of the in-app view.
  win.on("closed", () => {
    closeSettingsWindow();
  });
}

function buildUrl(tab?: SettingsTab): string {
  const params = new URLSearchParams({ settings: "1" });
  if (tab) params.set("settingsTab", tab);
  const query = params.toString();
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}?${query}`;
  }
  return `file://${join(__dirname, "../renderer/index.html")}?${query}`;
}

function dispatchNavigate(win: BrowserWindow, tab: SettingsTab): void {
  // Renderer may still be loading on a rapid second open() call. Queue the
  // navigate until did-finish-load so the message isn't dropped silently.
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) win.webContents.send("settings:navigate", tab);
    });
    return;
  }
  win.webContents.send("settings:navigate", tab);
}

export function openSettingsWindow(tab?: SettingsTab): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (tab) dispatchNavigate(settingsWindow, tab);
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#09090b",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (settingsWindow === win) settingsWindow = null;
  });

  win.loadURL(buildUrl(tab));
  settingsWindow = win;
}

export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
}

export function registerSettingsIpcHandlers(): void {
  ipcMain.handle("settings:open", (_event, tab?: SettingsTab) => {
    openSettingsWindow(tab);
  });
  ipcMain.on("settings:self-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  // T120: fan out "settings changed" to every renderer so each window's
  // TanStack Query cache refetches. Sender included — receivers can ignore
  // their own broadcast since they already invalidated locally.
  ipcMain.on("settings:broadcast-changed", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      if (win.webContents.id === event.sender.id) continue;
      win.webContents.send("settings:changed");
    }
  });
}
