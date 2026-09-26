import { app, dialog, globalShortcut } from "electron";
import { seedAgentLinkCache, stopSweep } from "./agents/agent-messaging";
import { getAgentManager } from "./agents/manager";
import { cleanupOldEvents, startNotifyHandler, stopNotifyHandler } from "./agents/notify-handler";
import { getQueueExecutor } from "./agents/queue";
import { getProviderRegistry } from "./agents/registry";
import { warmShellPath } from "./agents/spawn-env";
import { ensureAgentWrappers, sweepStaleAgentEvents } from "./agents/wrappers";
import { installDeepLinkHandling } from "./bootstrap/deep-link";
import { registerGlobalHotkey } from "./bootstrap/global-hotkey";
import { registerIpcHandlers } from "./bootstrap/ipc-handlers";
import { cleanupStaleData, runStartupRecovery } from "./bootstrap/recovery";
import { installSignalHandlers, runTeardown } from "./bootstrap/shutdown";
import { endMark, startMark } from "./bootstrap/startup-timings";
import { createWindow, showMainWindow } from "./bootstrap/window";
import { closeDatabase, getDb, initializeDatabase } from "./db/client";
import { getAppSettings } from "./db/queries/settings";
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
// After a GPU crash (moving the window across displays) Chromium may block WebGL for the
// origin until restart, leaving every terminal on the slower DOM renderer
app.disableDomainBlockingFor3DAPIs();

installDeepLinkHandling();

app.whenReady().then(async () => {
  startMark("appReady");
  // ─── Critical path: everything the window needs before first paint ──
  try {
    await initializeDatabase();
  } catch (err) {
    // A failed migration used to leave a running app with no window and no message
    logger.error("[Startup] database init failed", err);
    dialog.showErrorBox(
      "Exegol could not open its database",
      `${err instanceof Error ? err.message : String(err)}\n\nDatabase: ${app.getPath("userData")}/exegol.db`,
    );
    app.exit(1);
    return;
  }
  endMark("dbInit");
  ensureExegolMcpServerStarted(getDb()); // T163: the socket belongs to the app
  seedAgentLinkCache(getDb()); // T162: warm the in-memory has-links set
  const settings = getAppSettings(getDb());
  setMcpVerboseLogging(settings.mcpVerboseLogging === true);
  setDesktopChannelDb(getDb()); // T124: NotificationBus desktop channel settings lookup
  getProviderRegistry().loadFromDb(getDb()); // Load custom providers from DB
  registerTrpcIpcHandler();
  registerIpcHandlers();
  registerFloatingIpcHandlers();
  registerSettingsIpcHandlers();
  registerGlobalHotkey(settings.globalHotkey, showMainWindow);
  installAppMenu(); // Custom menu overrides Cmd+W to close pane, not window
  ensureCanonicalPaths(); // path resolution; required by some tRPC procedures
  endMark("criticalPath");
  // ────────────────────────────────────────────────────────────────────

  // Show window FIRST (fast TTI), then everything else in background
  createWindow();
  warmShellPath();
  endMark("windowCreated");
  initTray();

  // Background: non-blocking filesystem init (skills + wrappers)
  (() => {
    try {
      ensureDefaultSkills();
      ensureShellWrappers();
      ensureShellIntegration();
      ensureAgentWrappers();
      // Off the quit path on purpose — see sweepStaleAgentEvents.
      sweepStaleAgentEvents();
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
    // tool_use fires on every tool call: logging it buried everything else in bug reports
    if (event.type !== "tool_use") {
      logger.info(`[NotifyHandler] Agent event: ${event.type} from ${event.agentId}`);
    }
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

  // Dock click: a floating or settings window left open used to count as "a
  // window exists", so the main one never came back
  app.on("activate", showMainWindow);
});

// Keep app alive in system tray — quit only from tray menu
app.on("window-all-closed", () => {});

// Prevent crash on write EIO during shutdown (PTY writes after pipe closed)
process.on("uncaughtException", (err) => {
  if (err.message?.includes("EIO") || err.message?.includes("EPIPE")) return;
  // To the log file, not just the console: a packaged app has no console
  logger.error("[Crash] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  logger.error("[Crash] Unhandled rejection:", reason);
});
app.on("render-process-gone", (_event, contents, details) => {
  // A reload or a closed window, not a crash
  if (details.reason === "clean-exit") return;
  logger.error(
    `[Crash] Renderer gone (${details.reason}, exit ${details.exitCode}): ${contents.getURL()}`,
  );
});
app.on("child-process-gone", (_event, details) => {
  if (details.reason === "clean-exit") return;
  logger.error(
    `[Crash] ${details.type} process gone (${details.reason}, exit ${details.exitCode})${details.name ? `: ${details.name}` : ""}`,
  );
});

installSignalHandlers(() => runTeardown(teardownSteps()));

app.on("will-quit", () => {
  // Ordered by consequence: detach from the outside world, then stop our own
  // machinery, then close the database after every producer that can write to
  // it — notifyHandler, scheduler and queueExecutor all reach for the db from
  // callbacks, so closing earlier would let an in-flight one hit a dead handle.
  runTeardown(teardownSteps());
});

function teardownSteps() {
  return [
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
    { name: "mcpHost", run: () => getMcpHost().disconnectAll() },
    { name: "scheduler", run: () => getSchedulerEngine().stop() },
    { name: "queueExecutor", run: () => getQueueExecutor().stop() },
    { name: "metrics", run: stopMetricsCollector },
    { name: "messageSweep", run: stopSweep },
    { name: "database", run: closeDatabase },
    // Last: it silences console output, and until now it ran FIRST — hiding
    // every [Shutdown] line in the dev terminal, the one place someone chasing
    // a hang would look.
    { name: "logger", run: markShutdown },
  ];
}
