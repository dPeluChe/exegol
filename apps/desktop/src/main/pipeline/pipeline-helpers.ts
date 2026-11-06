import { readFile } from "node:fs/promises";
import type { PipelineStatusEvent } from "@exegol/shared";
import { stripAnsi } from "../agents/status-parser";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { broadcast } from "../lib/event-bus";
import { execFileAsync } from "../lib/exec-file";

export function broadcastPipelineStatus(event: PipelineStatusEvent): void {
  broadcast("pipeline:status-changed", event);
}

export { captureGitDiff, captureTree } from "./git-evidence";

export async function readScrollbackSummary(agentId: string): Promise<string> {
  try {
    const scrollbackPath = getScrollbackPath(agentId);
    const raw = await readFile(scrollbackPath, "utf-8");
    // Strip ANSI only on the tail portion to avoid processing entire file
    const tail = raw.length > 2000 ? raw.slice(-2000) : raw;
    return stripAnsi(tail);
  } catch {
    return "(no scrollback)";
  }
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

interface GitSyncStatus {
  clean: boolean;
  uncommittedChanges: boolean;
  unpushedCommits: number;
  message: string;
}

export async function checkGitSync(projectPath: string): Promise<GitSyncStatus> {
  const git = (args: string[]) =>
    execFileAsync("git", args, { cwd: projectPath, encoding: "utf-8", timeout: 5_000 }).then(
      (r) => r.stdout,
      () => null,
    );
  const [dirty, aheadOut] = await Promise.all([
    git(["status", "--porcelain"]),
    git(["rev-list", "@{u}..HEAD", "--count"]),
  ]);
  const uncommitted = !!dirty?.trim();
  const ahead = Number.parseInt(aheadOut?.trim() ?? "", 10) || 0;

  const issues: string[] = [];
  if (uncommitted) issues.push("uncommitted changes");
  if (ahead > 0) issues.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);

  return {
    clean: !uncommitted && ahead === 0,
    uncommittedChanges: uncommitted,
    unpushedCommits: ahead,
    message: issues.length > 0 ? `Warning: ${issues.join(" and ")}` : "Repository is up to date",
  };
}
