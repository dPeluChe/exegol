/**
 * Project Knowledge Node (T140) — DIGEST.md staleness tracking.
 * Each generated digest is stamped with the git HEAD sha it was built from;
 * staleness = N commits behind that sha (also triggers on missing digest).
 * No dedicated DB table — the marker lives inline in the (gitignored) file.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "../lib/logger";
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

function getCommitsBehind(projectPath: string, sha: string): number | null {
  try {
    const out = execSync(`git rev-list --count ${sha}..HEAD`, {
      cwd: projectPath,
      timeout: 5_000,
    }).toString("utf-8");
    const n = Number.parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

export function isDigestStale(projectPath: string): boolean {
  const path = getDigestPath(projectPath);
  if (!existsSync(path)) return true;

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    logger.warn("[Knowledge] Failed to read DIGEST.md for staleness check:", err);
    return true;
  }

  const match = content.match(DIGEST_HEAD_MARKER);
  if (!match?.[1]) return true;

  const behind = getCommitsBehind(projectPath, match[1]);
  if (behind === null) {
    // rev-list fails for two very different reasons: not a git repo (don't
    // loop refreshes) vs the stamped sha no longer existing (rebase, squash-
    // merge, gc) — in a live repo an unknown sha means definitively stale.
    return getGitHead(projectPath) !== null;
  }
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
export function refreshDigestIfStale(projectPath: string): { digest: string; refreshed: boolean } {
  if (isDigestStale(projectPath)) {
    return { digest: refreshDigest(projectPath), refreshed: true };
  }
  return { digest: readFileSync(getDigestPath(projectPath), "utf-8"), refreshed: false };
}
