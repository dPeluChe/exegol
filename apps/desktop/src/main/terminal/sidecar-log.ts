// sidecar.log: the detached sidecar's own story (start, sessions, gate pauses, trims, exit), plus
// discovery's view of it from main. Ids, pids, sizes and codes only: never terminal content,
// typed input, prompts or env values. The sidecar bundles this file.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

export const SIDECAR_LOG_MAX_BYTES = 1024 * 1024;

/** Pure: roll to `.1` when this line would take the file past the cap */
export function needsRotation(size: number, lineBytes: number, maxBytes: number): boolean {
  return size > 0 && size + lineBytes > maxBytes;
}

export function formatLogLine(now: Date, source: string, message: string): string {
  return `${now.toISOString()} [${source}] ${message}\n`;
}

/** Appends lines to `path`, keeping it under `maxBytes` with one rotated `.1` */
export function createSidecarLog(
  path: string,
  source: string,
  maxBytes = SIDECAR_LOG_MAX_BYTES,
  now: () => Date = () => new Date(),
): (message: string) => void {
  let dirReady = false;
  return (message) => {
    const line = formatLogLine(now(), source, message);
    try {
      if (!dirReady) {
        mkdirSync(dirname(path), { recursive: true });
        dirReady = true;
      }
      // Stat per line: main and the sidecar both append, and lines are rare
      if (needsRotation(fileSize(path), Buffer.byteLength(line), maxBytes)) {
        renameSync(path, `${path}.1`);
      }
      appendFileSync(path, line);
    } catch {
      /* logging must never take a terminal down */
    }
  };
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
