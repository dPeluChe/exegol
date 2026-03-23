import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from "electron";
import { getAgentManager } from "./agents/manager";
import { startNotifyHandler, stopNotifyHandler } from "./agents/notify-handler";
import { getQueueExecutor } from "./agents/queue";
import { getProviderRegistry } from "./agents/registry";
import { cleanupAgentWrappers, ensureAgentWrappers } from "./agents/wrappers";
import { closeDatabase, getDb, initializeDatabase } from "./db/client";
import { recoverStaleAgents } from "./db/queries";
import { registerTrpcIpcHandler } from "./ipc/trpc-ipc";
import { logger, markShutdown } from "./lib/logger";
import { getMcpHost } from "./mcp/host";
import { getPipelineExecutor } from "./pipeline/executor";
import { getSchedulerEngine } from "./scheduler/engine";
import { ensureDefaultSkills } from "./skills/discovery";
import { ensureCanonicalPaths } from "./skills/paths";
import {
  checkForUpdatesManual,
  initAutoUpdater,
  installUpdate,
  stopAutoUpdater,
} from "./system/auto-updater";
import { startMetricsCollector, stopMetricsCollector } from "./system/resources";
import { getPtyHost } from "./terminal/pty-host";
import { ensureShellWrappers } from "./terminal/shell-wrappers";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerGlobalHotkey(): void {
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

app.setName("Exegol");

function registerIpcHandlers(): void {
  // Terminal write: renderer -> main -> pty
  ipcMain.on("terminal:write", (_event, agentId: string, data: string) => {
    const manager = getAgentManager();
    manager.write(agentId, data);
  });

  // Terminal resize: renderer -> main -> pty
  ipcMain.on("terminal:resize", (_event, agentId: string, cols: number, rows: number) => {
    const manager = getAgentManager();
    manager.resize(agentId, cols, rows);
  });

  // App version
  ipcMain.handle("app:version", () => {
    return app.getVersion();
  });

  // Dialog: open folder picker
  ipcMain.handle("dialog:showOpenDialog", async (_event, options) => {
    return dialog.showOpenDialog(options);
  });

  // Auto-updater controls (T44)
  ipcMain.handle("updater:check", () => {
    checkForUpdatesManual();
  });
  ipcMain.handle("updater:install", () => {
    installUpdate();
  });

  // Window controls
  ipcMain.on("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on("window:close", () => {
    mainWindow?.close();
  });
}

app.whenReady().then(async () => {
  await initializeDatabase();
  // Recover agents from previous session — mark interrupted as "crashed", preserve scrollback
  const recovery = recoverStaleAgents(getDb());
  if (recovery.crashed > 0) {
    logger.info(`[Startup] Recovered ${recovery.crashed} crashed agent(s) from previous session`);
  }
  // Clean up stale agents:
  // - Shell terminals (always, no value)
  // - Crashed older than 1h (recent crashes kept for re-launch)
  // - Completed/failed/stopped older than 24h (recent ones stay for Recent Sessions)
  try {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const staleCleanup = getDb()
      .prepare(
        `DELETE FROM agents WHERE
          cli_type = 'shell'
          OR (status = 'crashed' AND stopped_at < ?)
          OR (status IN ('completed', 'failed', 'stopped') AND stopped_at < ?)`,
      )
      .run(oneHourAgo, oneDayAgo);
    if (staleCleanup.changes > 0) {
      logger.info(`[Startup] Cleaned ${staleCleanup.changes} stale agent(s)`);
    }
  } catch {
    /* table may not exist */
  }
  // Clean up contaminated memories (ANSI codes, CLI install output, raw terminal noise)
  try {
    const cleaned = getDb()
      .prepare(
        `DELETE FROM memories WHERE
          content LIKE '%' || X'1B' || '%'
          OR content LIKE '%' || X'0D' || '%'
          OR content LIKE '%bun install%'
          OR content LIKE '%npm install%'
          OR content LIKE '%yarn add%'
          OR content LIKE '%pip install%'
          OR content LIKE '%packages installed%'
          OR content LIKE '%Update now%'
          OR content LIKE '%Skip until next%'`,
      )
      .run();
    if (cleaned.changes > 0) {
      logger.info(`[Startup] Cleaned ${cleaned.changes} ANSI-contaminated memories`);
    }
  } catch {
    // Table may not exist yet
  }
  getProviderRegistry().loadFromDb(getDb()); // Load custom providers from DB
  registerTrpcIpcHandler();
  registerIpcHandlers();
  registerGlobalHotkey();
  ensureCanonicalPaths(); // Migrate to ~/.agents/skills/ + create agent symlinks
  ensureDefaultSkills(); // Install default skills to ~/.agents/skills/ if missing
  ensureShellWrappers(); // Create zsh/bash wrapper files for shell-ready marker
  ensureAgentWrappers(); // Create agent hooks + Claude Code settings merge
  startNotifyHandler((event) => {
    logger.info(`[NotifyHandler] Agent event: ${event.type} from ${event.agentId}`);
    // TODO: Route events to AgentManager for status updates (Phase 2)
  });
  startMetricsCollector(); // Background: collects CPU/RAM/disk every 10s
  getSchedulerEngine().start(getDb()); // Load scheduled tasks and start cron jobs
  getQueueExecutor().start(getDb()); // Start task queue executor
  getPipelineExecutor().recoverOnStartup(getDb()); // Recover stale pipeline runs
  initAutoUpdater(); // T44: check for updates on startup + every 4h
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Prevent crash on write EIO during shutdown (PTY writes after pipe closed)
process.on("uncaughtException", (err) => {
  if (err.message?.includes("EIO") || err.message?.includes("EPIPE")) return;
  console.error("Uncaught exception:", err);
});

app.on("will-quit", () => {
  markShutdown();
  globalShortcut.unregisterAll();

  // Stop all PTY subprocess sessions and close the database
  getPtyHost().destroyAll();

  stopAutoUpdater();
  stopNotifyHandler();
  cleanupAgentWrappers();
  getMcpHost().disconnectAll();
  getSchedulerEngine().stop();
  getQueueExecutor().stop();
  stopMetricsCollector();
  closeDatabase();
});
