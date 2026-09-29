import type { BrowserWindow } from "electron";

/** The workspace window. Kept apart from bootstrap/window so notifications can reach it without
 *  importing window creation (and everything it pulls in) */
let mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
