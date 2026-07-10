import { join, resolve } from "node:path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell, webContents } from "electron";
import windowStateKeeper from "electron-window-state";
import { getAgentManager } from "./agents/manager";
import { cleanupOldEvents, startNotifyHandler, stopNotifyHandler } from "./agents/notify-handler";
import { getQueueExecutor } from "./agents/queue";
import { getProviderRegistry } from "./agents/registry";
import { cleanupAgentWrappers, ensureAgentWrappers } from "./agents/wrappers";
import { closeDatabase, getDb, initializeDatabase } from "./db/client";
import { recoverStaleAgents } from "./db/queries";
import { registerTrpcIpcHandler } from "./ipc/trpc-ipc";
import { findDeepLinkArg, parseDeepLink } from "./lib/deeplink";
import { logger, markShutdown } from "./lib/logger";
import { stopExegolMcpServer } from "./mcp/exegol-server";
import { getMcpHost } from "./mcp/host";
import { setDesktopChannelDb } from "./notifications/channels/desktop";
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
import { ensureShellIntegration, ensureShellWrappers } from "./terminal/shell-wrappers";
import { installAppMenu } from "./windows/app-menu";
import {
  closeAllFloatingPanes,
  registerFloatingIpcHandlers,
  registerMainWindow,
} from "./windows/floating";
import {
  closeSettingsWindow,
  registerMainWindowForSettings,
  registerSettingsIpcHandlers,
} from "./windows/settings";

let mainWindow: BrowserWindow | null = null;

// ─── T155.6: exegol:// deep link (CLI opener) ─────────────────────────────

let pendingDeepLinkPath: string | null = null;

function deliverPendingDeepLink(win: BrowserWindow): void {
  if (!pendingDeepLinkPath) return;
  const path = pendingDeepLinkPath;
  pendingDeepLinkPath = null;
  win.webContents.send("deeplink:open-path", { path });
}

function handleDeepLinkUrl(url: string): void {
  const parsed = parseDeepLink(url);
  if (!parsed) {
    logger.warn(`[DeepLink] Ignored malformed url: ${url}`);
    return;
  }
  logger.info(`[DeepLink] open path: ${parsed.path}`);
  pendingDeepLinkPath = parsed.path;

  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    // Cold start (whenReady creates the window and flushes on load) or
    // tray-only mode — recreate the window; did-finish-load delivers.
    if (app.isReady()) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (win.webContents.isLoading()) return; // did-finish-load flushes
  deliverPendingDeepLink(win);
}

function registerDeepLinkProtocol(): void {
  // Dev mode on macOS/Windows: without execPath + entry args the OS silently
  // refuses to register the unpackaged Electron binary for the scheme.
  const entryArg = process.argv[1];
  if (process.defaultApp) {
    if (entryArg) {
      app.setAsDefaultProtocolClient("exegol", process.execPath, [resolve(entryArg)]);
    }
  } else {
    app.setAsDefaultProtocolClient("exegol");
  }
}

// Startup timing: measure from app ready to first paint.
// Logged once on ready-to-show to give us real numbers vs. competitors' claims.
const startupTimings: Record<string, number> = {};
const startupLogged = new Set<string>();
const startMark = (label: string) => {
  startupTimings[label] = Date.now();
};
const endMark = (label: string, from = "appReady") => {
  if (startupLogged.has(label)) return; // only log once per app lifetime
  const start = startupTimings[from];
  if (start) {
    startupLogged.add(label);
    logger.info(`[Startup] ${label}: ${Date.now() - start}ms`);
  }
};

function createWindow(): void {
  const state = windowStateKeeper({
    defaultWidth: 1400,
    defaultHeight: 900,
  });

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
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

  state.manage(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    endMark("firstPaint");
  });

  if (mainWindow) {
    registerMainWindow(mainWindow);
    registerMainWindowForSettings(mainWindow);
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // T155.6: deliver a deep link that arrived before (or during) load
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow) deliverPendingDeepLink(mainWindow);
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

// T155.6: single-instance — a second launch (e.g. Windows/Linux deep link)
// forwards its argv here and exits; macOS delivers URLs via open-url instead.
// Dev instances share userData with packaged ones, so only a packaged app
// hard-quits when it loses the lock.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    const url = findDeepLinkArg(argv);
    if (url) handleDeepLinkUrl(url);
  });
} else if (app.isPackaged) {
  app.quit();
}

// Must be registered before app ready — macOS can deliver the URL at launch.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});
registerDeepLinkProtocol();

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

  // ── T102: Design Mode + QA — browser pane IPC ──────────────────────

  /** Find the first <webview> webContents hosted by the sender window. */
  const findWebview = (sender: Electron.WebContents) =>
    webContents
      .getAllWebContents()
      .find((wc) => wc.getType() === "webview" && wc.hostWebContents === sender);

  // Inject JS into the webview and return the result
  ipcMain.handle("browser:execute-js", async (_event, { code }: { code: string }) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    return wv.executeJavaScript(code);
  });

  // Capture the webview as a base64 PNG screenshot
  ipcMain.handle("browser:capture-screenshot", async (_event) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    const image = await wv.capturePage();
    return image.toPNG().toString("base64");
  });

  // Capture a specific element's geometry + computed styles
  ipcMain.handle("browser:capture-element", async (_event, { selector }: { selector: string }) => {
    const wv = findWebview(_event.sender);
    if (!wv) return null;
    return wv.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const styles = getComputedStyle(el);
        return {
          selector: ${JSON.stringify(selector)},
          tagName: el.tagName.toLowerCase(),
          text: el.textContent?.slice(0, 200) ?? "",
          html: el.outerHTML.slice(0, 1000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: {
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            padding: styles.padding,
            margin: styles.margin,
          },
        };
      })()
    `);
  });
}

app.whenReady().then(async () => {
  startMark("appReady");
  // ─── Critical path: everything the window needs before first paint ──
  await initializeDatabase();
  endMark("dbInit");
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
    // Snapshot of DB agents at startup — helps diagnose recovery issues
    try {
      const db = getDb();
      const preRecoveryStats = db
        .prepare("SELECT status, COUNT(*) as count FROM agents GROUP BY status")
        .all() as Array<{ status: string; count: number }>;
      if (preRecoveryStats.length > 0) {
        logger.info(
          `[Startup] DB agent counts pre-recovery: ${preRecoveryStats
            .map((r) => `${r.status}=${r.count}`)
            .join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn("[Startup] Could not snapshot DB agents:", err);
    }

    let aliveSessionIds: string[] = [];
    let sidecarConnected = false;
    try {
      const sidecarClient = await ensureSidecar();
      getPtyHost().connectToSidecar(sidecarClient);
      sidecarConnected = true;
    } catch (err) {
      logger.warn("[Startup] PTY sidecar unavailable, using legacy subprocess mode:", err);
    }

    // Query sessions AFTER connection succeeded, with a separate try/catch so
    // a listInfo failure (e.g., older sidecar missing the RPC) doesn't cause
    // us to abandon the connected sidecar and fall back to legacy subprocess.
    if (sidecarConnected) {
      try {
        const sessionInfo = await getPtyHost().listSidecarSessionsInfo();
        aliveSessionIds = sessionInfo.filter((s) => s.alive).map((s) => s.id);
        const deadInfo = sessionInfo.filter((s) => !s.alive);
        logger.info(
          `[Startup] Sidecar connected — ${sessionInfo.length} total, ${aliveSessionIds.length} alive, ${deadInfo.length} dead`,
        );
        if (aliveSessionIds.length > 0) {
          logger.info(`[Startup] Alive sidecar sessions: ${aliveSessionIds.join(", ")}`);
        }
        if (deadInfo.length > 0) {
          logger.warn(
            `[Startup] Dead sidecar sessions (in 60s grace period): ${deadInfo
              .map((s) => `${s.id}(exit=${s.exitCode ?? "?"}/sig=${s.signal ?? "?"})`)
              .join(", ")}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unknown method")) {
          // Running against an older sidecar that doesn't have session.listInfo.
          // Fall back to session.list and treat all returned ids as alive.
          // Dead-session detection is lost for this run, but the sidecar stays
          // connected and new spawns work normally. The next restart will
          // reuse the new sidecar (version bump in pty-sidecar-protocol.ts
          // triggers a shutdown + respawn via ensureSidecar).
          logger.warn(
            "[Startup] Old sidecar detected (no session.listInfo). Dead-session detection disabled for this run — restart the app to auto-upgrade.",
          );
          try {
            aliveSessionIds = await getPtyHost().listSidecarSessions();
            logger.info(
              `[Startup] Fallback sidecar list — ${aliveSessionIds.length} session(s): ${aliveSessionIds.join(", ")}`,
            );
          } catch (fallbackErr) {
            logger.error("[Startup] Sidecar fallback listing failed:", fallbackErr);
          }
        } else {
          logger.error("[Startup] Sidecar listInfo failed:", err);
        }
      }
    }
    try {
      // Only agents that are ACTUALLY alive get skipped from the crash sweep.
      // Dead sidecar sessions (session map still populated during grace period
      // but PTY exited) fall through to recoverStaleAgents so they're marked
      // as crashed instead of sitting in DB as "running" with no live process.
      let aliveSkipIds = new Set<string>();
      if (aliveSessionIds.length > 0) {
        const result = await getAgentManager().reattachSidecarAgents(getDb(), aliveSessionIds);
        aliveSkipIds = result.aliveIds;
        logger.info(
          `[Startup] Reattach result: alive=${result.reattached}, dead=${result.deadIds.size}, failed=${result.failedIds.size}`,
        );
        if (result.deadIds.size > 0) {
          logger.warn(
            `[Startup] Dead sidecar sessions (will be marked crashed): ${Array.from(result.deadIds).join(", ")}`,
          );
        }
        if (result.failedIds.size > 0) {
          logger.warn(
            `[Startup] Failed reattach attempts (will be marked crashed): ${Array.from(result.failedIds).join(", ")}`,
          );
        }
      }
      const recovery = recoverStaleAgents(getDb(), aliveSkipIds);
      logger.info(
        `[Startup] Crash sweep: marked ${recovery.crashed} agent(s) as crashed (${recovery.alive} alive)`,
      );

      // Final snapshot after recovery — verify nothing is stuck
      try {
        const postStats = getDb()
          .prepare("SELECT status, COUNT(*) as count FROM agents GROUP BY status")
          .all() as Array<{ status: string; count: number }>;
        logger.info(
          `[Startup] DB agent counts post-recovery: ${postStats
            .map((r) => `${r.status}=${r.count}`)
            .join(", ")}`,
        );
      } catch {
        /* non-fatal */
      }
    } catch (err) {
      logger.error("[Startup] Agent recovery failed (non-fatal):", err);
    }
  })();

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

app.on("will-quit", () => {
  markShutdown();
  globalShortcut.unregisterAll();

  closeAllFloatingPanes();
  closeSettingsWindow();

  // T145: close the MCP socket + revoke all tokens so shim calls fail fast
  // instead of hanging, and the socket file doesn't go stale on disk.
  stopExegolMcpServer();

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
