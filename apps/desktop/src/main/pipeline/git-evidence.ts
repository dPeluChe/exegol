import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 16 * 1024 * 1024;

async function git(cwd: string, args: string[], env = process.env): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: MAX_DIFF_BYTES,
  });
  return stdout;
}

export async function captureTree(cwd: string, ref?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "exegol-pipeline-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, "index") };
    await git(cwd, ["read-tree", "HEAD"], env);
    await git(cwd, ["add", "--all", "--", "."], env);
    const tree = (await git(cwd, ["write-tree"], env)).trim();
    if (ref) await git(cwd, ["update-ref", ref, tree]);
    return tree;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function captureGitDiff(cwd: string, baseRevision?: string | null): Promise<string> {
  if (!baseRevision) return "(pipeline baseline unavailable; cannot determine changes)";
  try {
    const tree = await captureTree(cwd);
    const diff = await git(cwd, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      baseRevision,
      tree,
      "--",
      ".",
    ]);
    return diff || "(no changes)";
  } catch {
    return "(failed to capture git diff; check repository availability or the 16 MiB diff limit)";
  }
}
