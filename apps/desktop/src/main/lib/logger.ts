import { appendFileSync, mkdirSync } from "node:fs";
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

// Truncate log on startup so each session starts fresh
try {
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
