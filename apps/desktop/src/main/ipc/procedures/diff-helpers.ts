import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { coreRust } from "../../agents/spawn-env";
import { AsyncLruCache } from "../../lib/lru-cache";

export { coreRust };

// Cache shape: key = `${projectId}|${kind}|${staged}|${pathOverride ?? ""}`
// Invalidated whenever a mutation touches the same projectId.
// TTL: agents edit files without going through a mutation, so invalidation alone never sees them
export const diffCache = new AsyncLruCache<string, unknown>(6, 5_000);
export function invalidateProjectDiff(projectId: string): void {
  diffCache.invalidateWhere((k) => k.startsWith(`${projectId}|`));
}

export const execFileAsync = promisify(execFile);

// ─── gh CLI detection (cached) ─────────────────────────────────────────────

let ghAvailable: boolean | null = null;
export async function detectGhCli(): Promise<boolean> {
  if (ghAvailable) return true;
  // A miss is not cached: before the login-shell PATH lands, a Homebrew gh is invisible
  try {
    await execFileAsync("gh", ["--version"], { timeout: 3000 });
    ghAvailable = true;
  } catch {
    return false;
  }
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function resolveProjectPath(db: Database.Database, projectId: string): string {
  const row = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
    | { path: string }
    | undefined;
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Project ${projectId} not found` });
  }
  return row.path;
}

export async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", ...args], {
      cwd,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return stdout;
  } catch (err: unknown) {
    // git diff returns exit code 1 when there are differences
    if (err && typeof err === "object" && "stdout" in err) {
      return (err as { stdout: string }).stdout;
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to run git diff: ${err}`,
    });
  }
}
