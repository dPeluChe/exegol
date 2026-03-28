// Sidecar discovery: find running sidecar, or spawn a new one.

import { spawn as cpSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { SidecarClient } from "./pty-sidecar-client";
import {
  type PidFile,
  SIDECAR_CONNECT_TIMEOUT_MS,
  SIDECAR_PID_PATH,
  SIDECAR_SOCK_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(): PidFile | null {
  try {
    if (!existsSync(SIDECAR_PID_PATH)) return null;
    return JSON.parse(readFileSync(SIDECAR_PID_PATH, "utf-8")) as PidFile;
  } catch {
    return null;
  }
}

function resolveSidecarPath(): string {
  // Same directory as main bundle (rollupOptions.input output)
  const primary = join(__dirname, "pty-sidecar-entry.js");
  if (existsSync(primary)) return primary;
  // Fallback: nested under terminal/
  const nested = join(__dirname, "terminal", "pty-sidecar-entry.js");
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

function spawnSidecar(token: string): void {
  const sidecarPath = resolveSidecarPath();
  const child = cpSpawn(process.execPath, [sidecarPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", EXEGOL_SIDECAR_TOKEN: token },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
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
export async function ensureSidecar(): Promise<SidecarClient> {
  // Step 1: Check for existing sidecar
  const pidFile = readPidFile();
  if (pidFile && isProcessAlive(pidFile.pid)) {
    const client = new SidecarClient();
    if (await tryConnect(client, pidFile)) {
      return client;
    }
    // Stale sidecar — clean up
    try {
      process.kill(pidFile.pid, "SIGTERM");
    } catch {
      /* */
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
