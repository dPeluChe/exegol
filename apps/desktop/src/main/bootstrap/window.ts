import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { BrowserWindow, globalShortcut, shell } from "electron";
import windowStateKeeper from "electron-window-state";
import { registerMainWindow } from "../windows/floating";
import { registerMainWindowForSettings } from "../windows/settings";
import { deliverPendingDeepLink } from "./deep-link";
import { endMark } from "./startup-timings";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): void {
  const state = windowStateKeeper({
    defaultWidth: 1400,
    defaultHeight: 900,
  });

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#09090b",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  state.manage(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    endMark("firstPaint");
  });

  if (mainWindow) {
    registerMainWindow(mainWindow);
    registerMainWindowForSettings(mainWindow);
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // T155.6: deliver a deep link that arrived before (or during) load
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow) deliverPendingDeepLink(mainWindow);
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

export function registerGlobalHotkey(): void {
  const hotkey = DEFAULT_SETTINGS.globalHotkey;
  globalShortcut.register(hotkey, () => {
    if (!mainWindow) {
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });
}
