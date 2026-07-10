import {
  app,
  type BaseWindow,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";
import { installCli, uninstallCli } from "../system/cli-installer";
import { openSettingsWindow } from "./settings";

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
        {
          label: "Preferences…",
          accelerator: "Cmd+,",
          click: () => openSettingsWindow(),
        },
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
          // Main window: intercept and close the focused pane (not the
          // whole window). Auxiliary windows (settings, floating PiP)
          // close themselves — they don't have pane state.
          click: (_item, browserWindow) =>
            handleCloseAccelerator(browserWindow as BaseWindow | undefined),
        },
        { type: "separator" },
        {
          label: "Install 'exegol' CLI",
          click: () => handleInstallCli(),
        },
        {
          label: "Uninstall 'exegol' CLI",
          click: () => handleUninstallCli(),
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

/** T155.6: symlink resources/bin/exegol onto PATH and report the result. */
function handleInstallCli(): void {
  try {
    const target = installCli();
    void dialog.showMessageBox({
      type: "info",
      message: "exegol CLI installed",
      detail: `Symlinked at ${target}. Run \`exegol .\` in any project to open it here.`,
    });
  } catch (err) {
    dialog.showErrorBox(
      "Could not install the exegol CLI",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function handleUninstallCli(): void {
  try {
    const removed = uninstallCli();
    void dialog.showMessageBox({
      type: "info",
      message: removed.length > 0 ? "exegol CLI uninstalled" : "exegol CLI was not installed",
      detail: removed.length > 0 ? `Removed ${removed.join(", ")}` : undefined,
    });
  } catch (err) {
    dialog.showErrorBox(
      "Could not uninstall the exegol CLI",
      err instanceof Error ? err.message : String(err),
    );
  }
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

/**
 * Cmd+W router: settings + floating windows close themselves; the main
 * window forwards to the renderer's pane-close handler.
 */
function handleCloseAccelerator(win: BaseWindow | undefined): void {
  const candidate = win ?? BrowserWindow.getFocusedWindow();
  if (!candidate || candidate.isDestroyed()) return;
  if (!(candidate instanceof BrowserWindow)) return;
  const url = candidate.webContents.getURL();
  if (url.includes("settings=1") || url.includes("floatingPane=")) {
    candidate.close();
    return;
  }
  candidate.webContents.send("menu:close-pane");
}
