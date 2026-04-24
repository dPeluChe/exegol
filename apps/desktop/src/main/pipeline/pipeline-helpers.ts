import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { PipelineStatusEvent } from "@exegol/shared";
import { stripAnsi } from "../agents/status-parser";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { broadcast } from "../lib/event-bus";

export const YOLO_FLAGS: Record<string, string> = {
  "claude-code": "--dangerously-skip-permissions",
  codex: "--full-auto",
  aider: "--yes-always",
  goose: "--no-confirm",
  crush: "--yolo",
};

export function broadcastPipelineStatus(event: PipelineStatusEvent): void {
  broadcast("pipeline:status-changed", event);
}

export async function captureGitDiff(worktreePath: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      "git diff HEAD",
      { cwd: worktreePath, encoding: "utf-8", timeout: 10_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve("(failed to capture git diff)");
        } else {
          resolve(stdout || "(no changes)");
        }
      },
    );
  });
}

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

export interface GitSyncStatus {
  clean: boolean;
  uncommittedChanges: boolean;
  unpushedCommits: number;
  message: string;
}

export function checkGitSync(projectPath: string): Promise<GitSyncStatus> {
  return new Promise((resolve) => {
    exec(
      "git status --porcelain",
      { cwd: projectPath, encoding: "utf-8", timeout: 5_000 },
      (err1, dirtyOut) => {
        const uncommitted = !err1 && dirtyOut.trim().length > 0;

        exec(
          "git rev-list @{u}..HEAD --count 2>/dev/null",
          { cwd: projectPath, encoding: "utf-8", timeout: 5_000 },
          (err2, aheadOut) => {
            const ahead = err2 ? 0 : Number.parseInt(aheadOut.trim(), 10) || 0;

            const issues: string[] = [];
            if (uncommitted) issues.push("uncommitted changes");
            if (ahead > 0) issues.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);

            resolve({
              clean: !uncommitted && ahead === 0,
              uncommittedChanges: uncommitted,
              unpushedCommits: ahead,
              message:
                issues.length > 0 ? `Warning: ${issues.join(" and ")}` : "Repository is up to date",
            });
          },
        );
      },
    );
  });
}
