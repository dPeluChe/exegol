import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import type { ZodType } from "zod";
import { findOnPath } from "../agents/spawn-env";
import { childEnv } from "../lib/child-env";
import { mapWithConcurrency } from "../lib/concurrency";
import { execFileAsync } from "../lib/exec-file";
import { AsyncLruCache } from "../lib/lru-cache";
import { parseJson } from "../lib/parse-json";
import { StoreUnavailable } from "./types";

const LIST_TIMEOUT_MS = 5_000;
const LIST_MAX_BUFFER = 4 * 1024 * 1024;
const LIST_CONCURRENCY = 3;

/** The listings take 0.3-2 s (a process each); the launcher's check, the lost-session lookup and
 *  the spawn's own check then share one. Unfiltered, so every `since` reads the same entry */
const listings = new AsyncLruCache<string, unknown[]>(32, 15_000);

/**
 * A CLI's own JSON session listing, run in `cwd` (they scope by the current directory). No shell,
 * bounded time and output. stdout never reaches a log: parsed against `schema`, a mismatch is
 * StoreUnavailable, like a missing CLI or a failed run ("unknown", not "none"). Empty stdout is
 * none (kilo prints nothing).
 */
export function cliListing<T>(
  provider: string,
  command: string,
  args: string[],
  cwd: string,
  schema: ZodType<T[]>,
): Promise<T[]> {
  return listings.getOrCompute(`${provider}:${cwd}`, async () => {
    const bin = findOnPath(command);
    if (!bin) throw new StoreUnavailable(`${command} not installed`);
    if (!existsSync(cwd)) return [];
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(bin, args, {
        cwd,
        env: childEnv(),
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: LIST_MAX_BUFFER,
      }));
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      throw new StoreUnavailable(`${command} listing failed (${String(code ?? "error")})`);
    }
    if (!stdout.trim()) return [];
    const parsed = parseJson(stdout, schema);
    if (!parsed) throw new StoreUnavailable(`${command} listing: unexpected output`);
    return parsed;
  }) as Promise<T[]>;
}

/** An agent of this CLI ended in `cwd`: its session list changed */
export function forgetCliListing(provider: string, cwd: string): void {
  listings.invalidateWhere((key) => key === `${provider}:${cwd}`);
}

/**
 * `fn` per cwd; one that fails is skipped. Unavailable only when every cwd failed, so a removed
 * worktree does not hide the sessions of the others
 */
export async function eachCwd<T>(cwds: string[], fn: (cwd: string) => Promise<T[]>): Promise<T[]> {
  const results = await mapWithConcurrency(cwds, LIST_CONCURRENCY, (cwd) =>
    fn(cwd).then(
      (value): { value: T[] } | { error: unknown } => ({ value }),
      (error: unknown) => ({ error }),
    ),
  );
  const ok = results.flatMap((r) => ("value" in r ? [r.value] : []));
  if (ok.length === 0 && results.length > 0) {
    const first = results[0];
    throw first && "error" in first ? first.error : new StoreUnavailable("no listing");
  }
  return ok.flat();
}

/** Both sides of a cwd match: a CLI records the resolved path, Exegol may hold a symlinked one */
export async function realpathOr(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
