import { existsSync, mkdirSync, openSync, renameSync, rmSync, write, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const isDev = process.env.NODE_ENV !== "production";
let shuttingDown = false;

// ─── File logging ───────────────────────────────────────────────────────────

// Tests must never rotate (and so discard) the user's real logs
export const LOG_DIR = process.env.VITEST
  ? join(tmpdir(), "exegol-test-logs")
  : join(homedir(), ".exegol", "logs");
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* ignore */
}

const logFile = join(LOG_DIR, "exegol.log");
const MAX_ROTATED = 5;

/** The log's fd; writes are positional so the async batch and a sync flush can't reorder */
let fd: number | null = null;
let position = 0;

// Rotate on startup: exegol.log → exegol.1.log → … → exegol.5.log, so
// previous sessions survive restarts (needed to diagnose crash/recovery).
try {
  rmSync(join(LOG_DIR, `exegol.${MAX_ROTATED}.log`), { force: true });
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    const from = join(LOG_DIR, `exegol.${i}.log`);
    if (existsSync(from)) renameSync(from, join(LOG_DIR, `exegol.${i + 1}.log`));
  }
  if (existsSync(logFile)) renameSync(logFile, join(LOG_DIR, "exegol.1.log"));
  fd = openSync(logFile, "w");
  const header = Buffer.from(`--- Session started ${new Date().toISOString()} ---\n`);
  position = writeSync(fd, header, 0, header.length, 0);
} catch {
  /* ignore */
}

// appendFileSync per line blocked the main thread on every log call: lines now
// queue and go out in one async write per tick.
const FLUSH_DELAY_MS = 50;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: { buf: Buffer; at: number } | null = null;

function takeBatch(): { buf: Buffer; at: number } | null {
  if (pending.length === 0) return null;
  const buf = Buffer.from(pending.join(""));
  pending = [];
  const batch = { buf, at: position };
  position += buf.length;
  return batch;
}

function scheduleFlush(): void {
  if (flushTimer || inflight) return;
  flushTimer = setTimeout(flushAsync, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

function flushAsync(): void {
  flushTimer = null;
  if (fd === null || inflight) return;
  const batch = takeBatch();
  if (!batch) return;
  inflight = batch;
  write(fd, batch.buf, 0, batch.buf.length, batch.at, () => {
    inflight = null;
    if (pending.length > 0) scheduleFlush();
  });
}

/** Crash and exit paths: the queued lines (and a write still in flight) reach disk before we die */
export function flushLogSync(): void {
  if (fd === null) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    // Positional, so rewriting the in-flight batch is idempotent if it already landed
    if (inflight) writeSync(fd, inflight.buf, 0, inflight.buf.length, inflight.at);
    const batch = takeBatch();
    if (batch) writeSync(fd, batch.buf, 0, batch.buf.length, batch.at);
  } catch {
    /* non-fatal */
  }
}

process.on("exit", flushLogSync);

/** JSON.stringify(new Error()) is "{}": the message and stack were lost from every logged error */
function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function writeToFile(level: string, args: unknown[]): void {
  if (fd === null) return;
  try {
    const ts = new Date().toISOString();
    const msg = args.map(formatArg).join(" ");
    pending.push(`${ts} [${level}] ${msg}\n`);
    scheduleFlush();
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
