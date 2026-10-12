// sidecar.log: ids, pids, sizes and codes only, never terminal content, input, prompts or env.
// Main alone rotates it, at spawn (the sidecar's stderr fd stays on the live file for native
// crash output); past the soft cap the sidecar keeps only essential lines.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

/** Main rolls the file to `.1` past this when it spawns a sidecar */
export const SIDECAR_LOG_ROTATE_BYTES = 1024 * 1024;
/** A sidecar that lives for weeks stops routine lines here */
export const SIDECAR_LOG_SOFT_CAP_BYTES = 4 * 1024 * 1024;

/** Pure: routine lines stop past the soft cap; start, exit and errors always go in */
export function keepsLine(size: number, essential: boolean, softCap: number): boolean {
  return essential || size < softCap;
}

export function formatLogLine(now: Date, source: string, message: string): string {
  return `${now.toISOString()} [${source}] ${message}\n`;
}

/** Appends lines to `path`; never rotates (rotateSidecarLog does, from main) */
export function createSidecarLog(
  path: string,
  source: string,
  softCap = SIDECAR_LOG_SOFT_CAP_BYTES,
  now: () => Date = () => new Date(),
): (message: string, essential?: boolean) => void {
  let dirReady = false;
  return (message, essential = false) => {
    try {
      if (!dirReady) {
        mkdirSync(dirname(path), { recursive: true });
        dirReady = true;
      }
      if (!keepsLine(fileSize(path), essential, softCap)) return;
      appendFileSync(path, formatLogLine(now(), source, message));
    } catch {
      /* logging must never take a terminal down */
    }
  };
}

/** Main, right before it spawns a sidecar, whose stderr then opens the fresh file */
export function rotateSidecarLog(path: string, maxBytes = SIDECAR_LOG_ROTATE_BYTES): void {
  try {
    if (existsSync(path) && statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
  } catch {
    /* keep appending to the old file */
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** An error's message without the home folder (an error from fs or net names its path) */
export function scrubHome(text: string, home = homedir()): string {
  return home ? text.replaceAll(home, "~") : text;
}

export function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
