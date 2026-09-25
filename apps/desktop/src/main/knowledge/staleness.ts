/**
 * Project Knowledge Node (T140) — DIGEST.md staleness tracking.
 * Each generated digest is stamped with the git HEAD sha it was built from;
 * staleness = N commits behind that sha (also triggers on missing digest).
 * No dedicated DB table — the marker lives inline in the (gitignored) file.
 */

import { execFile, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { computeDigest } from "./digest";
import { ensureDigestGitignored, ensureKnowledgeDir, getDigestPath } from "./paths";

const DIGEST_HEAD_MARKER = /<!-- exegol:digest-head:([0-9a-f]{7,40}) -->\n?/;
const STALE_COMMIT_THRESHOLD = 10;

function getGitHead(projectPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectPath, timeout: 5_000 })
      .toString("utf-8")
      .trim();
  } catch {
    return null;
  }
}

const execFileAsync = promisify(execFile);

async function gitOut(projectPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: projectPath, timeout: 5_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * N commits behind the stamped sha. An unknown sha in a live repo (rebase,
 * squash-merge, gc) is stale; outside a repo it is not (no refresh loop).
 * Async: knowledge.get is a polled query and ran two execSync on the main process.
 */
export async function isDigestStale(projectPath: string): Promise<boolean> {
  const path = getDigestPath(projectPath);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return true;
  }
  const match = content.match(DIGEST_HEAD_MARKER);
  if (!match?.[1]) return true;
  const out = await gitOut(projectPath, ["rev-list", "--count", `${match[1]}..HEAD`]);
  const behind = out === null ? Number.NaN : Number.parseInt(out, 10);
  if (Number.isNaN(behind)) return (await gitOut(projectPath, ["rev-parse", "HEAD"])) !== null;
  return behind >= STALE_COMMIT_THRESHOLD;
}

/** Force-regenerate DIGEST.md and stamp it with the current git HEAD. */
export function refreshDigest(projectPath: string): string {
  const body = computeDigest(projectPath);
  const head = getGitHead(projectPath);
  const stamped = head ? `<!-- exegol:digest-head:${head} -->\n${body}` : body;

  ensureKnowledgeDir(projectPath);
  writeFileSync(getDigestPath(projectPath), stamped, "utf-8");
  ensureDigestGitignored(projectPath);
  return stamped;
}

/** Read the current digest, regenerating first if missing or stale. */
export async function refreshDigestIfStale(
  projectPath: string,
): Promise<{ digest: string; refreshed: boolean }> {
  if (await isDigestStale(projectPath)) {
    return { digest: refreshDigest(projectPath), refreshed: true };
  }
  return { digest: readFileSync(getDigestPath(projectPath), "utf-8"), refreshed: false };
}
