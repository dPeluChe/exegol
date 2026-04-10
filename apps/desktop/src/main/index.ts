import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from "electron";
import { getAgentManager } from "./agents/manager";
import { cleanupOldEvents, startNotifyHandler, stopNotifyHandler } from "./agents/notify-handler";
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
import { destroyTray, initTray } from "./system/tray";
import { getPtyHost } from "./terminal/pty-host";
import { ensureSidecar } from "./terminal/pty-sidecar-discovery";
import { ensureShellWrappers } from "./terminal/shell-wrappers";

let mainWindow: BrowserWindow | null = null;

// Startup timing: measure from app ready to first paint.
// Logged once on ready-to-show to give us real numbers vs. competitors' claims.
const startupTimings: Record<string, number> = {};
const startMark = (label: string) => {
  startupTimings[label] = Date.now();
};
const endMark = (label: string, from = "appReady") => {
  const start = startupTimings[from];
  if (start) {
    logger.info(`[Startup] ${label}: ${Date.now() - start}ms`);
  }
};

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
    endMark("firstPaint");
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

  // Terminal snapshot: replay ring buffer content for late-mounting terminals
  ipcMain.handle("terminal:get-snapshot", (_event, agentId: string) => {
    return getPtyHost().getSnapshot(agentId);
  });

  // Save clipboard image as temp file for terminal paste
  ipcMain.handle("terminal:save-clipboard-image", async () => {
    const { clipboard } = await import("electron");
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const name = `exegol-paste-${Date.now()}.png`;
    const filePath = join(tmpdir(), name);
    await writeFile(filePath, img.toPNG());
    return filePath;
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
  startMark("appReady");
  // ─── Critical path: everything the window needs before first paint ──
  await initializeDatabase();
  endMark("dbInit");
  getProviderRegistry().loadFromDb(getDb()); // Load custom providers from DB
  registerTrpcIpcHandler();
  registerIpcHandlers();
  registerGlobalHotkey();
  ensureCanonicalPaths(); // path resolution; required by some tRPC procedures
  endMark("criticalPath");
  // ────────────────────────────────────────────────────────────────────

  // Show window FIRST (fast TTI), then everything else in background
  createWindow();
  endMark("windowCreated");
  initTray();

  // Background: non-blocking filesystem init (skills + wrappers)
  (() => {
    try {
      ensureDefaultSkills();
      ensureShellWrappers();
      ensureAgentWrappers();
    } catch (err) {
      logger.error("[Startup] FS init failed (non-fatal):", err);
    }
  })();

  // Background: stale data cleanup (not needed before first paint)
  (() => {
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
      /* table may not exist yet */
    }
  })();

  // Background: sidecar connection + agent recovery (non-blocking)
  (async () => {
    let sidecarSessionIds: string[] = [];
    try {
      const sidecarClient = await ensureSidecar();
      getPtyHost().connectToSidecar(sidecarClient);
      sidecarSessionIds = await getPtyHost().listSidecarSessions();
      logger.info(
        `[Startup] Connected to PTY sidecar (${sidecarSessionIds.length} live session(s))`,
      );
    } catch (err) {
      logger.warn("[Startup] PTY sidecar unavailable, using legacy subprocess mode:", err);
    }
    try {
      if (sidecarSessionIds.length > 0) {
        const reattached = await getAgentManager().reattachSidecarAgents(
          getDb(),
          sidecarSessionIds,
        );
        if (reattached > 0) {
          logger.info(`[Startup] Reattached ${reattached} agent(s) from sidecar`);
        }
      }
      const recovery = recoverStaleAgents(getDb(), new Set(sidecarSessionIds));
      if (recovery.crashed > 0) {
        logger.info(
          `[Startup] Marked ${recovery.crashed} agent(s) as crashed (no sidecar session)`,
        );
      }
    } catch (err) {
      logger.error("[Startup] Agent recovery failed (non-fatal):", err);
    }
  })();

  // Background services (non-blocking, start after window)
  cleanupOldEvents(getDb());
  startNotifyHandler((event) => {
    logger.info(`[NotifyHandler] Agent event: ${event.type} from ${event.agentId}`);
  });
  startMetricsCollector();
  getSchedulerEngine().start(getDb());
  getQueueExecutor().start(getDb());
  getPipelineExecutor().recoverOnStartup(getDb());
  initAutoUpdater(); // Deferred: check for updates after window shows

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Keep app alive in system tray — quit only from tray menu
app.on("window-all-closed", () => {});

// Prevent crash on write EIO during shutdown (PTY writes after pipe closed)
process.on("uncaughtException", (err) => {
  if (err.message?.includes("EIO") || err.message?.includes("EPIPE")) return;
  console.error("Uncaught exception:", err);
});

app.on("will-quit", () => {
  markShutdown();
  globalShortcut.unregisterAll();

  // Sidecar mode: disconnect (sessions survive for reconnect on next launch)
  // Legacy mode: kill all subprocess PTY sessions
  const ptyHost = getPtyHost();
  if (ptyHost.isUsingSidecar()) {
    ptyHost.disconnectSidecar();
  } else {
    ptyHost.destroyAll();
  }

  destroyTray();
  stopAutoUpdater();
  stopNotifyHandler();
  cleanupAgentWrappers();
  getMcpHost().disconnectAll();
  getSchedulerEngine().stop();
  getQueueExecutor().stop();
  stopMetricsCollector();
  closeDatabase();
});
