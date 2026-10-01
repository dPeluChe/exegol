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
import { SidecarClient } from "./pty-sidecar-client";
import {
  type PidFile,
  SIDECAR_CONNECT_TIMEOUT_MS,
  SIDECAR_PID_PATH,
  SIDECAR_SOCK_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const execFileAsync = promisify(execFile);
const SIDECAR_ENTRY = "pty-sidecar-entry";

/** T184.4: a pid from the pid file may have been recycled; only kill it while it still runs our entry. */
export async function isOurSidecar(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      timeout: 3000,
    });
    return stdout.includes(SIDECAR_ENTRY);
  } catch {
    return false;
  }
}

export function readPidFile(): PidFile | null {
  try {
    if (!existsSync(SIDECAR_PID_PATH)) return null;
    return JSON.parse(readFileSync(SIDECAR_PID_PATH, "utf-8")) as PidFile;
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

async function tryConnect(client: SidecarClient, pidFile: PidFile): Promise<boolean> {
  try {
    await client.connect(pidFile.sock);
    const ping = await client.ping();
    if (ping.version !== SIDECAR_VERSION) {
      // Version mismatch — shut down old sidecar
      await client.shutdown().catch(() => {});
      client.disconnect();
      return false;
    }
    return true;
  } catch {
    client.disconnect();
    return false;
  }
}

/** The sidecar's own stderr (its crashes, server errors). It outlives the app,
 *  so it writes straight to a file; rolled once past a few MB. */
export const SIDECAR_LOG = join(LOG_DIR, "sidecar.log");

function openSidecarLog(): number | "ignore" {
  try {
    if (existsSync(SIDECAR_LOG) && statSync(SIDECAR_LOG).size > 5 * 1024 * 1024) {
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
      if (pidFile && pidFile.token === token && isProcessAlive(pidFile.pid)) {
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

/**
 * Ensure a sidecar is running and return a connected client.
 * Reuses existing sidecar if version matches, otherwise spawns a new one.
 */
/** The sidecar gives itself ~2s to drain before exiting; allow a little more,
 *  then stop waiting — a predecessor that will not die must not block startup. */
const EXIT_WAIT_MS = 3_000;
const EXIT_POLL_MS = 100;

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // gone
    }
    await new Promise((r) => setTimeout(r, EXIT_POLL_MS));
  }
  // Still alive: escalate rather than race it for the socket.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* */
  }
}

export async function ensureSidecar(): Promise<SidecarClient> {
  // Step 1: Check for existing sidecar
  const pidFile = readPidFile();
  if (pidFile && isProcessAlive(pidFile.pid)) {
    const client = new SidecarClient();
    if (await tryConnect(client, pidFile)) {
      return client;
    }
    // Stale sidecar — shut it down, and WAIT. Spawning a replacement while the
    // predecessor is still exiting is how the old process ended up deleting the
    // new one's socket and pid file (see cleanup() in pty-sidecar-entry).
    if (await isOurSidecar(pidFile.pid)) {
      try {
        process.kill(pidFile.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await waitForExit(pidFile.pid);
    } else {
      logger.warn("[PtySidecar] Pid file names a process that is not our sidecar; not killing it");
    }
  }

  // Clean up stale files
  try {
    unlinkSync(SIDECAR_PID_PATH);
  } catch {
    /* */
  }
  try {
    unlinkSync(SIDECAR_SOCK_PATH);
  } catch {
    /* */
  }

  // Step 2: Spawn new sidecar
  const token = randomBytes(16).toString("hex");
  spawnSidecar(token);

  // Step 3: Wait for it to become available
  const newPidFile = await waitForPidFile(token, SIDECAR_CONNECT_TIMEOUT_MS);

  // Step 4: Connect
  const client = new SidecarClient();
  await client.connect(newPidFile.sock);
  const ping = await client.ping();
  if (ping.version !== SIDECAR_VERSION) {
    throw new Error(`Sidecar version mismatch: ${ping.version} !== ${SIDECAR_VERSION}`);
  }

  return client;
}
