import { join } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { getDb } from "../db/client";
import { logger } from "../lib/logger";

let tray: Tray | null = null;

interface RunningAgent {
  id: string;
  cli_type: string;
  task_description: string | null;
}

function getRunningAgents(): RunningAgent[] {
  try {
    return getDb()
      .prepare(
        "SELECT id, cli_type, task_description FROM agents WHERE status IN ('running', 'spawning', 'waiting_input') AND cli_type != 'shell'",
      )
      .all() as RunningAgent[];
  } catch {
    return [];
  }
}

function buildContextMenu(agents: RunningAgent[]): Menu {
  const agentItems: Electron.MenuItemConstructorOptions[] =
    agents.length > 0
      ? [
          { type: "separator" },
          { label: "Running Agents", enabled: false },
          ...agents.map((a) => ({
            label: `${a.cli_type}${a.task_description ? ` — ${a.task_description.slice(0, 40)}` : ""}`,
            click: () => {
              const win = BrowserWindow.getAllWindows()[0];
              if (win) {
                win.show();
                win.focus();
                win.webContents.send("notification:navigate", { agentId: a.id });
              }
            },
          })),
        ]
      : [];

  const win = BrowserWindow.getAllWindows()[0];
  const isVisible = win?.isVisible() ?? false;

  return Menu.buildFromTemplate([
    {
      label: isVisible ? "Hide Exegol" : "Show Exegol",
      click: () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w) return;
        if (w.isVisible()) {
          w.hide();
        } else {
          w.show();
          w.focus();
        }
      },
    },
    ...agentItems,
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
}

function updateTrayBadge(count: number): void {
  if (!tray) return;
  tray.setToolTip(count > 0 ? `Exegol — ${count} agent${count > 1 ? "s" : ""} running` : "Exegol");
  if (process.platform === "darwin") {
    tray.setTitle(count > 0 ? `${count}` : "", { fontType: "monospacedDigit" });
  }
}

export function initTray(): void {
  const iconPath = join(__dirname, "../../resources/build/icons/icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  refreshTray();

  tray.on("click", () => {
    if (process.platform === "darwin") {
      tray?.popUpContextMenu(buildContextMenu(getRunningAgents()));
    } else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win?.isVisible()) {
        win.hide();
      } else {
        win?.show();
        win?.focus();
      }
    }
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(buildContextMenu(getRunningAgents()));
  });

  logger.info("[Tray] System tray initialized");
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Rebuild tray menu + badge. Throttled to avoid DB queries on hot path. */
export function refreshTray(): void {
  if (!tray) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!tray) return;
    const agents = getRunningAgents();
    tray.setContextMenu(buildContextMenu(agents));
    updateTrayBadge(agents.length);
  }, 200);
}

export function destroyTray(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  tray?.destroy();
  tray = null;
}
