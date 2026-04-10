import {
  app,
  type BaseWindow,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";

/**
 * Install a custom application menu on macOS.
 *
 * The default Electron menu on macOS binds Cmd+W to "Close Window", which
 * kills the main window. We want Cmd+W to close a pane (or a tab if the
 * pane is the last one) — matching terminal emulator conventions. The
 * renderer already has a Cmd+W handler; we just need to prevent the
 * default menu item from intercepting the accelerator first.
 *
 * Strategy: emit a custom IPC event to the focused renderer that the
 * `useHotkeys` hook listens to for the close-pane behavior. Only Cmd+Q
 * closes the actual window.
 */
export function installAppMenu(): void {
  if (process.platform !== "darwin") {
    // On Windows/Linux we don't force a menu — the default is fine.
    Menu.setApplicationMenu(null);
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: `Quit ${app.name}`, accelerator: "Cmd+Q" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "Cmd+T",
          click: (_item, browserWindow) =>
            sendToRenderer(browserWindow as BaseWindow | undefined, "menu:new-tab"),
        },
        {
          label: "Close Pane",
          accelerator: "Cmd+W",
          // IMPORTANT: explicitly NOT role: "close" — we want to intercept
          // the accelerator so the renderer closes the focused pane, not
          // the whole window.
          click: (_item, browserWindow) =>
            sendToRenderer(browserWindow as BaseWindow | undefined, "menu:close-pane"),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: () => shell.openExternal("https://github.com/dPeluChe/labs-exegol"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendToRenderer(win: BaseWindow | undefined, channel: string): void {
  // Electron's click handler signature gives us BaseWindow, but only
  // BrowserWindow has webContents. Guard with an instance check.
  const candidate = win ?? BrowserWindow.getFocusedWindow();
  if (!candidate || candidate.isDestroyed()) return;
  if (candidate instanceof BrowserWindow) {
    candidate.webContents.send(channel);
  }
}
