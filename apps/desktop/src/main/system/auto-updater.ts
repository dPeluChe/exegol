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

const GITHUB_OWNER = "dPeluChe";
const GITHUB_REPO = "exegol";

const STABLE_FEED = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download`;
const CANARY_FEED = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/desktop-canary`;

const UPDATE_FEED_URL = IS_PRERELEASE ? CANARY_FEED : STABLE_FEED;

/**
 * Errors the user cannot act on, and what to call them in the log.
 *
 * ONE table: two lists both claiming a 404 made the classification undecidable
 * — `SILENT_ERRORS` already carried `HttpError: 404` and ran first, so a second
 * list leading with the bare substring `404` could never win. And `404` alone
 * matches a version, a port or a path just as happily.
 */
const SILENCED: Array<{ reason: string; needles: string[] }> = [
  {
    reason: "Network error (will retry later)",
    needles: [
      "net::ERR_INTERNET_DISCONNECTED",
      "net::ERR_NETWORK_CHANGED",
      "net::ERR_CONNECTION_REFUSED",
      "net::ERR_CONNECTION_RESET",
      "net::ERR_NAME_NOT_RESOLVED",
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
    ],
  },
  {
    // A repo with no release answers 404 for the feed, at launch and every four
    // hours after. "Nothing has been published yet" is not a broken updater.
    reason: "No published release to update from — staying on this build",
    needles: [
      "Cannot find latest-mac.yml",
      "Cannot find latest.yml",
      "No published versions",
      "latest-mac.yml in the latest release artifacts",
    ],
  },
];

/** electron-updater surfaces builder-util-runtime's `HttpError`, which carries
 *  a real status code — worth more than matching the library's prose. */
function statusCodeOf(error: Error): number | undefined {
  return (error as Error & { statusCode?: number }).statusCode;
}

/** The log reason when this error must not reach the user, else null. */
function silencedReason(error: Error): string | null {
  if (statusCodeOf(error) === 404) return "No published release to update from";
  const msg = error.message ?? "";
  return SILENCED.find((s) => s.needles.some((n) => msg.includes(n)))?.reason ?? null;
}

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
    const silenced = silencedReason(error);
    if (silenced) {
      logger.info(`[AutoUpdater] ${silenced}:`, error.message);
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
