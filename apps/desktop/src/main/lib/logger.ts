import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const isDev = process.env.NODE_ENV !== "production";
let shuttingDown = false;

// ─── File logging ───────────────────────────────────────────────────────────

const LOG_DIR = join(homedir(), ".exegol", "logs");
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* ignore */
}

const logFile = join(LOG_DIR, "exegol.log");
const MAX_ROTATED = 5;

// Rotate on startup: exegol.log → exegol.1.log → … → exegol.5.log, so
// previous sessions survive restarts (needed to diagnose crash/recovery).
try {
  rmSync(join(LOG_DIR, `exegol.${MAX_ROTATED}.log`), { force: true });
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    const from = join(LOG_DIR, `exegol.${i}.log`);
    if (existsSync(from)) renameSync(from, join(LOG_DIR, `exegol.${i + 1}.log`));
  }
  if (existsSync(logFile)) renameSync(logFile, join(LOG_DIR, "exegol.1.log"));
  require("node:fs").writeFileSync(
    logFile,
    `--- Session started ${new Date().toISOString()} ---\n`,
  );
} catch {
  /* ignore */
}

function writeToFile(level: string, args: unknown[]): void {
  try {
    const ts = new Date().toISOString();
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    appendFileSync(logFile, `${ts} [${level}] ${msg}\n`);
  } catch {
    /* non-fatal */
  }
}

// ─── Logger ─────────────────────────────────────────────────────────────────

/** Mark logger as shutting down — silences write errors during app exit */
export function markShutdown(): void {
  shuttingDown = true;
}

function safePrint(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  if (shuttingDown) return;
  try {
    fn(...args);
  } catch {
    // Ignore EIO errors during shutdown
  }
}

export const logger = {
  info: (...args: unknown[]) => {
    writeToFile("INFO", args);
    if (isDev) safePrint(console.log, ...args);
  },
  warn: (...args: unknown[]) => {
    writeToFile("WARN", args);
    safePrint(console.warn, ...args);
  },
  error: (...args: unknown[]) => {
    writeToFile("ERROR", args);
    safePrint(console.error, ...args);
  },
  debug: (...args: unknown[]) => {
    writeToFile("DEBUG", args);
    if (isDev) safePrint(console.log, "[DEBUG]", ...args);
  },
};

/** Path to today's log file */
export const LOG_FILE_PATH = logFile;
