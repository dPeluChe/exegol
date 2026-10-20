import { join } from "node:path";
import { app, Menu, nativeImage, shell, Tray } from "electron";
import { isAgentAwaitingApproval } from "../agents/agent-messaging";
import { getProviderRegistry } from "../agents/registry";
import { getDb } from "../db/client";
import { LOG_DIR, logger } from "../lib/logger";
import { getMainWindow } from "../windows/main-window-ref";
import { cachedPlanUsage } from "./plan-usage";
import {
  buildTrayProjects,
  type TrayAgent,
  type TrayAgentRow,
  type TrayAgentState,
  type TrayProject,
  trayAgentsIn,
  trayLimits,
  traySignature,
  traySummary,
} from "./tray-menu";

let tray: Tray | null = null;

const LIVE_AGENTS_SQL = `SELECT a.id, a.alias, a.cli_type, a.task_description, a.status, a.started_at,
       a.status_changed_at, a.project_id, p.name AS project_name
  FROM agents a JOIN projects p ON p.id = a.project_id
  WHERE a.status IN ('running', 'spawning', 'waiting_input') AND a.cli_type != 'shell'
    AND a.archived_at IS NULL`;

function getTrayProjects(): TrayProject[] {
  try {
    const rows = getDb().prepare(LIVE_AGENTS_SQL).all() as TrayAgentRow[];
    return buildTrayProjects(rows, cliName, isAgentAwaitingApproval, Date.now());
  } catch {
    return [];
  }
}

const STATE_MARK: Record<TrayAgentState, string> = {
  "needs-you": "⚠︎",
  working: "●",
  starting: "◐",
  idle: "○",
};

// Lazy: bootstrap/ pulls BrowserWindow into every module that imports the tray
function sendToMainWindow(channel: string, payload?: unknown): void {
  void import("../bootstrap/window").then((m) => m.showMainWindowWith(channel, payload));
}

function toggleMainWindow(): void {
  const win = getMainWindow();
  if (win?.isVisible()) win.hide();
  else void import("../bootstrap/window").then((m) => m.showMainWindow());
}

function openAgent(agentId: string): void {
  sendToMainWindow("notification:navigate", { agentId });
}

function agentItem(agent: TrayAgent): Electron.MenuItemConstructorOptions {
  const label = `${STATE_MARK[agent.state]}  ${agent.label}`;
  // sublabel renders only on macOS; elsewhere the detail joins the label
  return process.platform === "darwin"
    ? { label, sublabel: agent.detail, click: () => openAgent(agent.id) }
    : { label: `${label}  (${agent.detail})`, click: () => openAgent(agent.id) };
}

function cliName(cliType: string): string {
  return getProviderRegistry().get(cliType)?.name ?? cliType;
}

function stateSubmenu(
  projects: TrayProject[],
  state: TrayAgentState,
  title: string,
): Electron.MenuItemConstructorOptions[] {
  const agents = trayAgentsIn(projects, state);
  return agents.length > 0
    ? [{ label: `${title} (${agents.length})`, submenu: agents.map(agentItem) }]
    : [];
}

function limitsItems(): Electron.MenuItemConstructorOptions[] {
  const limits = trayLimits(cachedPlanUsage(), cliName, Date.now());
  return limits
    ? [
        {
          label: limits.title,
          submenu: limits.lines.map((line) => ({ label: line, enabled: false })),
        },
      ]
    : [];
}

function buildContextMenu(projects: TrayProject[]): Menu {
  const agentItems: Electron.MenuItemConstructorOptions[] =
    projects.length > 0
      ? [
          { type: "separator" },
          { label: traySummary(projects), enabled: false },
          ...stateSubmenu(projects, "needs-you", "Needs you"),
          ...stateSubmenu(projects, "working", "Working"),
          ...projects.flatMap((p): Electron.MenuItemConstructorOptions[] => [
            { type: "separator" },
            { label: p.name, enabled: false },
            ...p.agents.map(agentItem),
            ...(p.hidden.length > 0
              ? [
                  {
                    label: `${p.hidden.length} more…`,
                    submenu: p.hidden.map(agentItem),
                  },
                ]
              : []),
          ]),
        ]
      : [];

  const win = getMainWindow();
  const isVisible = win?.isVisible() ?? false;

  return Menu.buildFromTemplate([
    {
      label: isVisible ? "Hide Exegol" : "Show Exegol",
      click: toggleMainWindow,
    },
    {
      label: "Open Dashboard",
      click: () => sendToMainWindow("menu:open-dashboard"),
    },
    ...agentItems,
    { type: "separator" },
    ...limitsItems(),
    {
      label: "Report a Bug…",
      click: () => sendToMainWindow("menu:report-bug"),
    },
    {
      label: "Open Logs Folder",
      click: () => void shell.openPath(LOG_DIR),
    },
    { type: "separator" },
    {
      label: "Settings…",
      // Lazy: windows/ would pull BrowserWindow into every module that imports the tray
      click: () => void import("../windows/settings").then((m) => m.openSettingsWindow()),
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
}

let shownCount = 0;
/** "● REC 0:42" while a dictation records with no Exegol window focused; wins over the count */
let recording: string | null = null;

function updateTrayBadge(count: number): void {
  shownCount = count;
  if (!tray) return;
  const agents = count > 0 ? `Exegol — ${count} agent${count > 1 ? "s" : ""} running` : "Exegol";
  tray.setToolTip(recording ? `Exegol — dictation recording (${recording})` : agents);
  // setTitle shows on macOS and on Linux app indicators; Windows keeps the tooltip
  if (process.platform !== "win32") {
    const title = recording ?? (process.platform === "darwin" && count > 0 ? `${count}` : "");
    tray.setTitle(title, { fontType: "monospacedDigit" });
  }
}

export function setTrayRecording(label: string | null): void {
  if (label === recording) return;
  recording = label;
  updateTrayBadge(shownCount);
}

export function initTray(): void {
  // Packaged: shipped via extraResources; dev: __dirname is out/main
  const mac = process.platform === "darwin";
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, mac ? "trayTemplate.png" : "tray-icon.png")
    : join(__dirname, "../../src/resources/build/icons", mac ? "trayTemplate.png" : "icon.png");
  // The template's @2x sibling loads with it; the color icon is scaled down
  const loaded = nativeImage.createFromPath(iconPath);
  const icon = mac ? loaded : loaded.resize({ width: 18, height: 18 });
  if (mac) icon.setTemplateImage(true);

  tray = new Tray(icon);
  refreshTray();

  tray.on("click", () => {
    if (process.platform === "darwin") {
      tray?.popUpContextMenu(buildContextMenu(getTrayProjects()));
    } else {
      toggleMainWindow();
    }
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(buildContextMenu(getTrayProjects()));
  });

  logger.info("[Tray] System tray initialized");
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastSignature = "";

/** Rebuild tray badge + menu. Throttled */
export function refreshTray(): void {
  if (!tray) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!tray) return;
    const projects = getTrayProjects();
    updateTrayBadge(projects.reduce((n, p) => n + p.agents.length + p.hidden.length, 0));
    // Rebuild only when agents or states change (avoids the macOS warning); a click builds it fresh
    const signature = traySignature(projects);
    if (signature !== lastSignature) {
      lastSignature = signature;
      tray.setContextMenu(buildContextMenu(projects));
    }
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
