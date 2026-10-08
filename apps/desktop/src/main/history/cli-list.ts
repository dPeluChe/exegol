import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { findOnPath } from "../agents/spawn-env";
import { childEnv } from "../lib/child-env";
import { StoreUnavailable } from "./types";

const LIST_TIMEOUT_MS = 5_000;
const LIST_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * A CLI's own session listing, run in `cwd` (they scope by the current directory). No shell,
 * bounded time and output; stdout is returned and never logged. Throws StoreUnavailable when the
 * CLI is missing or the listing fails, so callers can tell "unknown" from "none".
 */
export function runCliListing(command: string, args: string[], cwd: string): Promise<string> {
  const bin = findOnPath(command);
  if (!bin) return Promise.reject(new StoreUnavailable(`${command} not installed`));
  if (!existsSync(cwd)) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, env: childEnv(), timeout: LIST_TIMEOUT_MS, maxBuffer: LIST_MAX_BUFFER },
      (err, stdout) => {
        if (err)
          reject(new StoreUnavailable(`${command} ${args[0]} failed (${err.code ?? err.name})`));
        else resolve(stdout);
      },
    );
  });
}

/** Both sides of a cwd match: a CLI records the resolved path, Exegol may hold a symlinked one */
export async function realpathOr(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
