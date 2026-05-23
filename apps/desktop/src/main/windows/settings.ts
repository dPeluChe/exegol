/**
 * Settings window (T120).
 *
 * Settings used to be an in-app view; now it lives in its own BrowserWindow so
 * users can keep an eye on agent output while tweaking config. The window is
 * parented to the main window (lifecycle tied — closes when main closes) and
 * intentionally does NOT use alwaysOnTop (anti-pattern noted in the Terax
 * review).
 */

import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, ipcMain } from "electron";

export type SettingsTab = "general" | "clis" | "terminal" | "shortcuts" | "apikeys";

let settingsWindow: BrowserWindow | null = null;
let mainWindowRef: BrowserWindow | null = null;

export function registerMainWindowForSettings(win: BrowserWindow): void {
  mainWindowRef = win;
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

export function openSettingsWindow(tab?: SettingsTab): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (tab) settingsWindow.webContents.send("settings:navigate", tab);
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
    parent: mainWindowRef ?? undefined,
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
}
