// The sidecar's pid file is its lease: discovery reuses the sidecar it names, and a sidecar exits
// once the file no longer names its token. Bundled by the sidecar.
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isNamedPipe } from "../lib/ipc-endpoint";
import {
  holdsLease,
  type PidFile,
  parsePidFile,
  SIDECAR_PID_PATH,
  SIDECAR_SOCK_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";

/** The pid file's text; null when it is gone, undefined when it could not be read (no evidence) */
function readPidFileText(): string | null | undefined {
  try {
    return readFileSync(SIDECAR_PID_PATH, "utf-8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
  }
}

export function createSidecarLease(token: string) {
  /** Inode of the socket file our listen() created */
  let socketIno: number | null = null;

  /** Give up the pid file (only ours): discovery then spawns a successor instead of reusing us */
  const release = (): void => {
    try {
      if (parsePidFile(readPidFileText())?.token === token) unlinkSync(SIDECAR_PID_PATH);
    } catch {
      /* already gone */
    }
  };

  return {
    /** Right after listen(): name ourselves in the pid file */
    claim(): void {
      // A named pipe has no inode and closes with us: nothing to clean up
      if (!isNamedPipe(SIDECAR_SOCK_PATH)) socketIno = statSync(SIDECAR_SOCK_PATH).ino;
      const pidFile: PidFile = {
        pid: process.pid,
        token,
        version: SIDECAR_VERSION,
        sock: SIDECAR_SOCK_PATH,
      };
      writeFileSync(SIDECAR_PID_PATH, JSON.stringify(pidFile), "utf-8");
    },
    holds: (): boolean => holdsLease(readPidFileText(), token),
    release,
    /** Remove our pid file and socket, never a successor's (2026-08-13: an exiting predecessor
     *  deleted the replacement's files and orphaned it) */
    cleanup(): void {
      release();
      try {
        if (socketIno !== null && statSync(SIDECAR_SOCK_PATH).ino === socketIno) {
          unlinkSync(SIDECAR_SOCK_PATH);
        }
      } catch {
        /* already gone */
      }
    },
  };
}
