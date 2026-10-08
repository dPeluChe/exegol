import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { coreRust } from "../../agents/spawn-env";
import { execFileAsync } from "../../lib/exec-file";
import { AsyncLruCache } from "../../lib/lru-cache";

export { coreRust };

// Cache shape: key = `${projectId}|${kind}|${staged}|${pathOverride ?? ""}`
// Invalidated whenever a mutation touches the same projectId.
// TTL: agents edit files without going through a mutation, so invalidation alone never sees them
export const diffCache = new AsyncLruCache<string, unknown>(6, 5_000);
export function invalidateProjectDiff(projectId: string): void {
  diffCache.invalidateWhere((k) => k.startsWith(`${projectId}|`));
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

const GIT_MAX_BUFFER = 5 * 1024 * 1024;

function execGit(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, maxBuffer: GIT_MAX_BUFFER });
}

export async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execGit(cwd, ["diff", ...args]);
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

/** The lines of a failed git run worth showing: its fatal/error lines, else the last few */
export function gitErrorSummary(err: unknown): string {
  const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const text =
    String(e?.stderr ?? "").trim() || String(e?.stdout ?? "").trim() || String(e?.message ?? err);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("hint:"));
  const errors = lines.filter((l) => /^(fatal|error):/i.test(l));
  const summary = (errors.length > 0 ? errors : lines.slice(-3)).join("\n");
  return summary.length > 400 ? `${summary.slice(0, 400)}…` : summary;
}

/** Runs git; a failure throws an Error carrying git's own message instead of "Command failed" */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execGit(cwd, args);
    return stdout;
  } catch (err) {
    throw new Error(gitErrorSummary(err));
  }
}
