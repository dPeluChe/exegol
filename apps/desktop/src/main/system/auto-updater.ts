// Auto-updater — checks GitHub Releases for new versions (T44).
// Uses electron-updater with generic provider.
// Silent on network errors, auto-downloads, installs on quit.

import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { prerelease } from "semver";
import { logger } from "../lib/logger";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
let checkTimer: ReturnType<typeof setInterval> | null = null;

// Detect channel from version string (e.g., "0.2.0-canary.20260320" → canary)
const IS_PRERELEASE = prerelease(app.getVersion()) !== null;

// TODO: replace with actual GitHub owner/repo when publishing
const GITHUB_OWNER = "OWNER";
const GITHUB_REPO = "exegol";

const STABLE_FEED = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download`;
const CANARY_FEED = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/desktop-canary`;

const UPDATE_FEED_URL = IS_PRERELEASE ? CANARY_FEED : STABLE_FEED;

// Network errors that should be silenced (retry later, don't bother user)
const SILENT_ERRORS = [
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_NAME_NOT_RESOLVED",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "HttpError: 404",
];

function isNetworkError(error: Error): boolean {
  const msg = error.message ?? "";
  return SILENT_ERRORS.some((e) => msg.includes(e));
}

/** Broadcast update status to all renderer windows */
function broadcastUpdateStatus(status: string, info?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("updater:status", { status, info });
  }
}

/** Initialize the auto-updater. Call once after app is ready. */
export function initAutoUpdater(): void {
  // Don't run in dev mode
  if (!app.isPackaged) {
    logger.info("[AutoUpdater] Skipping — app is not packaged (dev mode)");
    return;
  }

  // Configure
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = IS_PRERELEASE; // Allow canary → stable downgrade

  try {
    autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL });
  } catch (err) {
    logger.warn("[AutoUpdater] Failed to set feed URL:", err);
    return;
  }

  // ── Event handlers ──────────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    logger.info("[AutoUpdater] Checking for update...");
    broadcastUpdateStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    logger.info("[AutoUpdater] Update available:", info.version);
    broadcastUpdateStatus("available", { version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    logger.info("[AutoUpdater] No update available");
    broadcastUpdateStatus("up-to-date");
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastUpdateStatus("downloading", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logger.info("[AutoUpdater] Update downloaded:", info.version);
    broadcastUpdateStatus("ready", { version: info.version });
  });

  autoUpdater.on("error", (error) => {
    if (isNetworkError(error)) {
      logger.info("[AutoUpdater] Network error (will retry later):", error.message);
      broadcastUpdateStatus("idle");
      return;
    }
    logger.error("[AutoUpdater] Error:", error.message);
    broadcastUpdateStatus("error", { message: error.message });
  });

  // ── Initial check + periodic interval ─────────────────────────────

  // Delay initial check by 10s (let app finish startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10_000);

  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);

  logger.info(
    `[AutoUpdater] Initialized (channel: ${IS_PRERELEASE ? "canary" : "stable"}, feed: ${UPDATE_FEED_URL})`,
  );
}

/** Stop the periodic check timer. Call on app quit. */
export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/** Manually trigger an update check (from UI). */
export function checkForUpdatesManual(): void {
  autoUpdater.checkForUpdates().catch(() => {});
}

/** Install a downloaded update now (restarts the app). */
export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
