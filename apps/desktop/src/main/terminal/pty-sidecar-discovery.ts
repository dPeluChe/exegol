// Sidecar discovery: find running sidecar, or spawn a new one.

import { spawn as cpSpawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOG_DIR, logger } from "../lib/logger";
import { withTimeout } from "../lib/timeout";
import { SidecarClient } from "./pty-sidecar-client";
import {
  type PidFile,
  parsePidFile,
  SIDECAR_CONNECT_TIMEOUT_MS,
  SIDECAR_PID_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";
import { createSidecarLog, SIDECAR_LOG_MAX_BYTES } from "./sidecar-log";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const SIDECAR_ENTRY = "pty-sidecar-entry";

export function readPidFile(): PidFile | null {
  try {
    return parsePidFile(readFileSync(SIDECAR_PID_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function resolveSidecarPath(): string {
  // Same directory as main bundle (rollupOptions.input output)
  const primary = join(__dirname, `${SIDECAR_ENTRY}.js`);
  if (existsSync(primary)) return primary;
  // Fallback: nested under terminal/
  const nested = join(__dirname, "terminal", `${SIDECAR_ENTRY}.js`);
  if (existsSync(nested)) return nested;
  return primary;
}

/** A sidecar of another version about to be shut down, with the sessions it still runs */
export interface SidecarReplacement {
  from: string;
  to: string;
  liveSessionIds: string[];
}

/** "ready": reuse it; "retiring": another version, asked to shut down; "unreachable": no answer */
async function tryConnect(
  client: SidecarClient,
  pidFile: PidFile,
  onReplace?: (r: SidecarReplacement) => void,
): Promise<"ready" | "retiring" | "unreachable"> {
  try {
    await client.connect(pidFile.sock);
    const ping = await client.ping();
    if (ping.version === SIDECAR_VERSION) return "ready";
    const info = await client.listSessionsInfo().catch(() => []);
    const liveSessionIds = info.filter((s) => s.alive).map((s) => s.id);
    logger.warn(
      `[Sidecar] replacing ${ping.version} -> ${SIDECAR_VERSION} (${liveSessionIds.length} live session(s))`,
    );
    sidecarLog(
      `replacing pid ${pidFile.pid}: ${ping.version} -> ${SIDECAR_VERSION}, ${liveSessionIds.length} live session(s)`,
    );
    try {
      onReplace?.({ from: ping.version, to: SIDECAR_VERSION, liveSessionIds });
    } catch (err) {
      logger.warn("[Sidecar] replacement inventory failed:", err);
    }
    await client.shutdown().catch(() => {});
    client.disconnect();
    return "retiring";
  } catch {
    client.disconnect();
    return "unreachable";
  }
}

/** The sidecar's log (sidecar-log.ts) and its stderr. It outlives the app, so it writes straight
 *  to a file; rolled to `.1` past 1 MB. Same file as SIDECAR_LOG_PATH outside tests */
export const SIDECAR_LOG = join(LOG_DIR, "sidecar.log");
const sidecarLog = createSidecarLog(SIDECAR_LOG, "Discovery");

/** Pure: what discovery found, for sidecar.log (no paths) */
export function describePidFile(pidFile: PidFile | null, alive: boolean): string {
  if (!pidFile) return "pid file: none";
  return `pid file: pid ${pidFile.pid} (${alive ? "alive" : "gone"}), version ${pidFile.version}`;
}

function openSidecarLog(): number | "ignore" {
  try {
    if (existsSync(SIDECAR_LOG) && statSync(SIDECAR_LOG).size > SIDECAR_LOG_MAX_BYTES) {
      renameSync(SIDECAR_LOG, `${SIDECAR_LOG}.1`);
    }
    return openSync(SIDECAR_LOG, "a");
  } catch {
    return "ignore";
  }
}

function spawnSidecar(token: string): void {
  const sidecarPath = resolveSidecarPath();
  const log = openSidecarLog();
  const child = cpSpawn(process.execPath, [sidecarPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", EXEGOL_SIDECAR_TOKEN: token },
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();
  if (typeof log === "number") closeSync(log);
}

function waitForPidFile(token: string, timeoutMs: number): Promise<PidFile> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      const pidFile = readPidFile();
      if (pidFile?.token === token) {
        resolve(pidFile);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Sidecar did not start within timeout"));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

/** A predecessor asked to shut down exits in ~0.5s; past this, stop waiting so one that will
 *  not die does not block startup. Drop with the wait once no sidecar before 1.6.0 is in use. */
const EXIT_WAIT_MS = 3_000;
const EXIT_POLL_MS = 100;

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) {
      logger.warn(`[PtySidecar] Previous sidecar (pid ${pid}) did not exit; not signalling it`);
      return;
    }
    await new Promise((r) => setTimeout(r, EXIT_POLL_MS));
  }
}

/**
 * Ensure a sidecar is running and return a connected client.
 * Reuses existing sidecar if version matches, otherwise spawns a new one.
 */
export async function ensureSidecar(
  onReplace?: (r: SidecarReplacement) => void,
): Promise<SidecarClient> {
  const pidFile = readPidFile();
  const alive = !!pidFile && isProcessAlive(pidFile.pid);
  sidecarLog(`${describePidFile(pidFile, alive)}, app ${SIDECAR_VERSION}`);
  if (pidFile && alive) {
    const client = new SidecarClient();
    const state = await tryConnect(client, pidFile, onReplace);
    if (state === "ready") {
      sidecarLog(`reusing pid ${pidFile.pid}`);
      return client;
    }
    if (state === "unreachable")
      sidecarLog(`pid ${pidFile.pid} did not answer, spawning a new one`);
    // Nothing is signalled (the pid may be recycled). Wait for one we asked to shut down:
    // sidecars before 1.6.0 unlink the socket path on exit even after a successor bound it
    if (state === "retiring") await waitForExit(pidFile.pid);
  }

  // Ends the predecessor's lease: one that did not answer exits by itself (holdsLease)
  try {
    unlinkSync(SIDECAR_PID_PATH);
  } catch {
    /* */
  }

  const token = randomBytes(16).toString("hex");
  spawnSidecar(token);

  const newPidFile = await waitForPidFile(token, SIDECAR_CONNECT_TIMEOUT_MS);

  const client = new SidecarClient();
  await client.connect(newPidFile.sock);
  const ping = await client.ping();
  if (ping.version !== SIDECAR_VERSION) {
    throw new Error(`Sidecar version mismatch: ${ping.version} !== ${SIDECAR_VERSION}`);
  }
  sidecarLog(`spawned pid ${newPidFile.pid}`);
  return client;
}

/** Retry: a fresh socket to the sidecar already running. Never spawns one (that ends every
 *  session); dropping the old socket also lets the sidecar resume PTYs it paused for it */
export async function reconnectSidecar(): Promise<SidecarClient> {
  const pidFile = readPidFile();
  if (!pidFile || !isProcessAlive(pidFile.pid)) throw new Error("No sidecar is running");
  const client = new SidecarClient();
  try {
    await client.connect(pidFile.sock);
    const ping = await withTimeout(client.ping(), 5_000, "Sidecar ping");
    if (ping.version !== SIDECAR_VERSION) throw new Error("Sidecar version changed");
    return client;
  } catch (err) {
    client.disconnect();
    throw err;
  }
}

/** The pid file's process, if it still runs our sidecar entry (a pid can be recycled) */
async function runsSidecar(pid: number): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-o", "args=", "-p", String(pid)], {
      timeout: 3_000,
    });
    return stdout.includes(SIDECAR_ENTRY);
  } catch {
    return false;
  }
}

/** Restart terminals: what `kill:sidecar` does, from the app. Asks first, then signals; every
 *  PTY it holds ends. The next ensureSidecar spawns a fresh one */
export async function stopSidecarProcess(client: SidecarClient | null): Promise<void> {
  const pidFile = readPidFile();
  if (client) await withTimeout(client.shutdown(), 1_000, "Sidecar shutdown").catch(() => {});
  client?.disconnect();
  if (pidFile && isProcessAlive(pidFile.pid) && (await runsSidecar(pidFile.pid))) {
    process.kill(pidFile.pid, "SIGTERM");
    await waitForExit(pidFile.pid);
    if (isProcessAlive(pidFile.pid)) process.kill(pidFile.pid, "SIGKILL");
  }
  try {
    unlinkSync(SIDECAR_PID_PATH);
  } catch {
    /* */
  }
}
