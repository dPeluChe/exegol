import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { app, BrowserWindow } from "electron";
import windowStateKeeper from "electron-window-state";
import { registerMainWindow } from "../windows/floating";
import { getMainWindow, setMainWindowRef } from "../windows/main-window-ref";
import { registerMainWindowForSettings } from "../windows/settings";
import { deliverPendingDeepLink } from "./deep-link";
import { endMark } from "./startup-timings";

let mainWindow: BrowserWindow | null = null;

export { getMainWindow };

let focusRelayInstalled = false;

/** The app's focus for the main window's polls (TanStack focusManager): any Exegol window
 *  counts, so Settings or a PiP window does not pause the panes still on screen */
function installFocusRelay(): void {
  if (focusRelayInstalled) return;
  focusRelayInstalled = true;
  const send = (focused: boolean) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send("window:focus-changed", focused);
  };
  app.on("browser-window-focus", () => send(true));
  // Focus moving between our windows blurs one before the other gains it
  app.on("browser-window-blur", () =>
    setImmediate(() => {
      if (!BrowserWindow.getFocusedWindow()) send(false);
    }),
  );
}

export function createWindow(): void {
  installFocusRelay();
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

  // Closing leaves a destroyed object behind: the global hotkey called
  // isMinimized() on it, threw, and never opened a window again
  const win = mainWindow;
  setMainWindowRef(win);
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      setMainWindowRef(null);
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    endMark("firstPaint");
  });

  if (mainWindow) {
    registerMainWindow(mainWindow);
    registerMainWindowForSettings(mainWindow);
  }

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

export function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isVisible()) mainWindow.focus();
  else mainWindow.show();
}
