import { app, BrowserWindow, globalShortcut } from "electron";
import { seedAgentLinkCache } from "./agents/agent-messaging";
import { getAgentManager } from "./agents/manager";
import { cleanupOldEvents, startNotifyHandler, stopNotifyHandler } from "./agents/notify-handler";
import { getQueueExecutor } from "./agents/queue";
import { getProviderRegistry } from "./agents/registry";
import { cleanupAgentWrappers, ensureAgentWrappers } from "./agents/wrappers";
import { installDeepLinkHandling } from "./bootstrap/deep-link";
import { registerIpcHandlers } from "./bootstrap/ipc-handlers";
import { cleanupStaleData, runStartupRecovery } from "./bootstrap/recovery";
import { installSignalHandlers, runTeardown } from "./bootstrap/shutdown";
import { endMark, startMark } from "./bootstrap/startup-timings";
import { createWindow, registerGlobalHotkey } from "./bootstrap/window";
import { closeDatabase, getDb, initializeDatabase } from "./db/client";
import { registerTrpcIpcHandler } from "./ipc/trpc-ipc";
import { logger, markShutdown } from "./lib/logger";
import {
  ensureExegolMcpServerStarted,
  setMcpVerboseLogging,
  stopExegolMcpServer,
} from "./mcp/exegol-server";
import { getMcpHost } from "./mcp/host";
import { setDesktopChannelDb } from "./notifications/channels/desktop";
import { getPipelineExecutor } from "./pipeline/executor";
import { getSchedulerEngine } from "./scheduler/engine";
import { ensureDefaultSkills } from "./skills/discovery";
import { ensureCanonicalPaths } from "./skills/paths";
import { initAutoUpdater, stopAutoUpdater } from "./system/auto-updater";
import { startMetricsCollector, stopMetricsCollector } from "./system/resources";
import { destroyTray, initTray } from "./system/tray";
import { getPtyHost } from "./terminal/pty-host";
import { ensureShellIntegration, ensureShellWrappers } from "./terminal/shell-wrappers";
import { installAppMenu } from "./windows/app-menu";
import { closeAllFloatingPanes, registerFloatingIpcHandlers } from "./windows/floating";
import { closeSettingsWindow, registerSettingsIpcHandlers } from "./windows/settings";

app.setName("Exegol");

installDeepLinkHandling();

app.whenReady().then(async () => {
  startMark("appReady");
  // ─── Critical path: everything the window needs before first paint ──
  await initializeDatabase();
  endMark("dbInit");
  ensureExegolMcpServerStarted(getDb()); // T163: the socket belongs to the app
  seedAgentLinkCache(getDb()); // T162: warm the in-memory has-links set
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
      | { value: string }
      | undefined;
    if (row) setMcpVerboseLogging(JSON.parse(row.value)?.mcpVerboseLogging === true);
  } catch {
    /* settings not readable yet — verbose stays off */
  }
  setDesktopChannelDb(getDb()); // T124: NotificationBus desktop channel settings lookup
  getProviderRegistry().loadFromDb(getDb()); // Load custom providers from DB
  registerTrpcIpcHandler();
  registerIpcHandlers();
  registerFloatingIpcHandlers();
  registerSettingsIpcHandlers();
  registerGlobalHotkey();
  installAppMenu(); // Custom menu overrides Cmd+W to close pane, not window
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
      ensureShellIntegration();
      ensureAgentWrappers();
    } catch (err) {
      logger.error("[Startup] FS init failed (non-fatal):", err);
    }
  })();

  // Background: stale data cleanup (not needed before first paint)
  cleanupStaleData();

  // Background: sidecar connection + agent recovery (non-blocking)
  void runStartupRecovery();

  // Background services (non-blocking, start after window)
  cleanupOldEvents(getDb());
  startNotifyHandler((event) => {
    logger.info(`[NotifyHandler] Agent event: ${event.type} from ${event.agentId}`);
    try {
      getAgentManager().handleAgentFileEvent(getDb(), event);
    } catch (err) {
      logger.warn("[NotifyHandler] Failed to apply agent event:", err);
    }
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

installSignalHandlers();

app.on("will-quit", () => {
  markShutdown();
  // Ordered by consequence: detach from the outside world, then stop our own
  // machinery, then close the database LAST — it is the step whose absence is
  // felt on the next launch, so nothing before it may be able to skip it.
  runTeardown([
    { name: "globalShortcut", run: () => globalShortcut.unregisterAll() },
    { name: "floatingPanes", run: closeAllFloatingPanes },
    { name: "settingsWindow", run: closeSettingsWindow },
    // T145: close the MCP socket + revoke all tokens so shim calls fail fast
    // instead of hanging, and the socket file doesn't go stale on disk.
    { name: "mcpServer", run: stopExegolMcpServer },
    {
      name: "ptyHost",
      run: () => {
        // Sidecar mode: disconnect (sessions survive for reconnect on next
        // launch). Legacy mode: kill all subprocess PTY sessions.
        const ptyHost = getPtyHost();
        if (ptyHost.isUsingSidecar()) ptyHost.disconnectSidecar();
        else ptyHost.destroyAll();
      },
    },
    { name: "tray", run: destroyTray },
    { name: "autoUpdater", run: stopAutoUpdater },
    { name: "notifyHandler", run: stopNotifyHandler },
    { name: "agentWrappers", run: cleanupAgentWrappers },
    { name: "mcpHost", run: () => getMcpHost().disconnectAll() },
    { name: "scheduler", run: () => getSchedulerEngine().stop() },
    { name: "queueExecutor", run: () => getQueueExecutor().stop() },
    { name: "metrics", run: stopMetricsCollector },
    { name: "database", run: closeDatabase },
  ]);
});
