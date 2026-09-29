import { BrowserWindow } from "electron";

/** The workspace window, never Settings or a floating pane (getAllWindows()[0] could be either) */
export function mainAppWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => {
    const url = w.webContents.getURL();
    return !url.includes("settings=1") && !url.includes("floatingPane=");
  });
}
