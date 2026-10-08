import { app, dialog, globalShortcut, shell } from "electron";
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
import { installAgentBrowser, migrateBrowserCookies } from "./browser/electron-host";
import { closeDatabase, getDb, initializeDatabase } from "./db/client";
import { getAppSettings } from "./db/queries/settings";
import { stopEngine } from "./dictation/engine";
import { forwardDictationKeys } from "./dictation/keys";
import { installMediaPermissions } from "./dictation/mic";
import { applyDictationSettings, dictationSettings } from "./dictation/service";
import { startPrWatch, stopPrWatch } from "./integrations/github/pr-watch";
import { registerDictationIpc } from "./ipc/procedures/dictation";
import { registerTrpcIpcHandler } from "./ipc/trpc-ipc";
import { broadcast } from "./lib/event-bus";
import { flushLogSync, logger, markShutdown } from "./lib/logger";
import {
  ensureExegolMcpServerStarted,
  getMcpAgentStates,
  setMcpStatusListener,
  setMcpVerboseLogging,
  stopExegolMcpServer,
} from "./mcp/exegol-server";
import { getMcpHost } from "./mcp/host";
import { setDesktopChannelDb } from "./notifications/channels/desktop";
import { getPipelineExecutor } from "./pipeline/executor";
import { getSchedulerEngine } from "./scheduler/engine";
import { ensureDefaultSkills } from "./skills/discovery";
import { ensureCanonicalPaths } from "./skills/paths";
import { integrateAppImage } from "./system/appimage-integration";
import { initAutoUpdater, stopAutoUpdater } from "./system/auto-updater";
import { captureConsole } from "./system/console-capture";
import { scheduleHousekeeping } from "./system/housekeeping";
import { backfillProjectIcons } from "./system/project-icons";
import { startMetricsCollector, stopMetricsCollector } from "./system/resources";
import { destroyTray, initTray } from "./system/tray";
import { startWorkGuard } from "./system/work-guard";
import { getPtyHost } from "./terminal/pty-host";
import { EXEGOL_DIR } from "./terminal/pty-sidecar-protocol";
import { ensureShellIntegration, ensureShellWrappers } from "./terminal/shell-wrappers";
import { installAppMenu } from "./windows/app-menu";
import { closeAllFloatingPanes, registerFloatingIpcHandlers } from "./windows/floating";
import { forwardSwitcherKeys } from "./windows/pane-switcher-keys";
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
    flushLogSync();
    app.exit(1);
    return;
  }
  endMark("dbInit");
  ensureExegolMcpServerStarted(getDb()); // T163: the socket belongs to the app
  setMcpStatusListener(() => broadcast("mcp:status", { agents: getMcpAgentStates(getDb()) }));
  seedAgentLinkCache(getDb()); // T162: warm the in-memory has-links set
  const settings = getAppSettings(getDb());
  setMcpVerboseLogging(settings.mcpVerboseLogging === true);
  setDesktopChannelDb(getDb()); // T124: NotificationBus desktop channel settings lookup
  getProviderRegistry().loadFromDb(getDb()); // Load custom providers from DB
  registerTrpcIpcHandler();
  registerIpcHandlers();
  registerFloatingIpcHandlers();
  registerSettingsIpcHandlers();
  registerDictationIpc();
  applyDictationSettings(getDb(), dictationSettings(getDb()));
  installMediaPermissions();
  installAgentBrowser(getDb());
  registerGlobalHotkey(settings.globalHotkey, showMainWindow);
  installAppMenu(); // Custom menu overrides Cmd+W to close pane, not window
  ensureCanonicalPaths(); // path resolution; required by some tRPC procedures
  // Before any pane loads: a project's first page in its own partition finds its logins there.
  // Capped, so a slow cookie store never holds the window back
  await Promise.race([
    migrateBrowserCookies(getDb()).catch((err) =>
      logger.warn("[Startup] browser cookie migration failed:", err),
    ),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
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
  // Once: projects added before icons were kept get theirs (off the startup path)
  setTimeout(() => void backfillProjectIcons(getDb()).catch(() => {}), 5_000);

  // Background: sidecar connection + agent recovery (non-blocking). The scheduler waits for it:
  // stopping an interrupted run's agent needs its reattached PTY
  void runStartupRecovery().finally(() => {
    getSchedulerEngine().start(getDb());
    scheduleHousekeeping(getDb(), { exegolDir: EXEGOL_DIR, userData: app.getPath("userData") });
  });

  // Background services (non-blocking, start after window)
  cleanupOldEvents(getDb());
  stopWorkGuard = startWorkGuard(getDb());
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
  getQueueExecutor().start(getDb());
  getAgentManager().startShellPromotion(getDb());
  startPrWatch();
  getPipelineExecutor().recoverOnStartup(getDb());
  initAutoUpdater(); // Deferred: check for updates after window shows
  integrateAppImage(); // Linux AppImage: a menu entry so it can be found again

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
  flushLogSync();
});
process.on("unhandledRejection", (reason) => {
  logger.error("[Crash] Unhandled rejection:", reason);
});
let stopWorkGuard: (() => void) | null = null;

app.on("web-contents-created", (_event, contents) => {
  captureConsole(contents);
  if (contents.getType() === "webview") {
    forwardSwitcherKeys(contents);
    forwardDictationKeys(contents);
  }
  // Every Exegol window (settings and floating ones too, not only main): a link must not open
  // an Electron child window, which would hand the preload's window.api to that page
  if (contents.getType() === "window") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
    // A plain link click navigated the window itself away from the app, preload included
    contents.on("will-navigate", (event, url) => {
      if (url.startsWith("file://") || url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\0"))
        return;
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
    });
  }
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
    { name: "dictationEngine", run: stopEngine },
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
    { name: "workGuard", run: () => stopWorkGuard?.() },
    { name: "tray", run: destroyTray },
    { name: "autoUpdater", run: stopAutoUpdater },
    { name: "notifyHandler", run: stopNotifyHandler },
    { name: "mcpHost", run: () => getMcpHost().disconnectAll() },
    { name: "scheduler", run: () => getSchedulerEngine().stop() },
    { name: "queueExecutor", run: () => getQueueExecutor().stop() },
    { name: "metrics", run: stopMetricsCollector },
    { name: "messageSweep", run: stopSweep },
    { name: "prWatch", run: stopPrWatch },
    { name: "database", run: closeDatabase },
    // Last: it silences console output, and until now it ran FIRST — hiding
    // every [Shutdown] line in the dev terminal, the one place someone chasing
    // a hang would look.
    { name: "logger", run: markShutdown },
  ];
}
