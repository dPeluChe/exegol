// After a lost sidecar: which sessions come back by themselves. Relaunching all 36 at once took
// process memory from 11.2 to 15 GB; the renderer staggers the resumes, this picks them.
import { statSync } from "node:fs";

/** Sessions idle longer than this stay suspended (Resume in their pane) */
export const AUTO_RESUME_MAX_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

export interface LostSession {
  id: string;
  /** ms */
  lastActiveAt: number;
}

/** Pure: the newest of the persisted activity, the last status change and the start, read
 *  before the crash sweep moves status_changed_at to now */
export function lastActiveOf(row: {
  last_activity_at?: number | null;
  status_changed_at?: number | null;
  started_at?: number | null;
}): number {
  return Math.max(
    row.last_activity_at ?? 0,
    row.status_changed_at ?? 0,
    (row.started_at ?? 0) * 1000,
  );
}

/** Pure: recent ones to resume (most recent first), the rest to keep suspended */
export function splitLost(
  lost: LostSession[],
  now: number,
  maxIdleMs = AUTO_RESUME_MAX_IDLE_MS,
  /** Pinned in Watching: a commitment to that session, never kept suspended */
  pinned: ReadonlySet<string> = new Set(),
): { resume: LostSession[]; keep: LostSession[] } {
  const recent = (s: LostSession) => pinned.has(s.id) || now - s.lastActiveAt <= maxIdleMs;
  const byRecency = [...lost].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return { resume: byRecency.filter(recent), keep: byRecency.filter((s) => !recent(s)) };
}

export type ShellFolder =
  | { cwd: string; decision: "kept" }
  | { cwd: undefined; decision: "none" | "gone" | "outside the project" };

/** Pure: a resumed shell reopens in its last folder while it still exists inside the project */
export function shellResumeFolder(
  lastCwd: string | null,
  exists: boolean,
  allowed: boolean,
): ShellFolder {
  if (!lastCwd) return { cwd: undefined, decision: "none" };
  if (!exists) return { cwd: undefined, decision: "gone" };
  if (!allowed) return { cwd: undefined, decision: "outside the project" };
  return { cwd: lastCwd, decision: "kept" };
}

/** A directory we can stat; a refused or malformed path (EACCES, a NUL byte) counts as gone */
export function folderExists(path: string | null): boolean {
  if (!path) return false;
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** The folder decision of each resumed shell, for its [AutoResume] line (no path). Manual
 *  resumes note one too and nobody reads it: past the cap the oldest go */
const shellFolders = new Map<string, string>();
const SHELL_FOLDER_NOTES = 256;

export function noteShellFolder(sourceId: string, decision: ShellFolder["decision"]): void {
  shellFolders.delete(sourceId);
  shellFolders.set(
    sourceId,
    decision === "kept" ? "folder kept" : `folder ${decision}, project root`,
  );
  if (shellFolders.size > SHELL_FOLDER_NOTES) {
    const oldest = shellFolders.keys().next().value;
    if (oldest !== undefined) shellFolders.delete(oldest);
  }
}

export function takeShellFolder(sourceId: string): string | undefined {
  const d = shellFolders.get(sourceId);
  shellFolders.delete(sourceId);
  return d;
}

/** Pure: the newest session in a resume chain (each new row names the one it resumed) */
export function followChain(start: string, childOf: (id: string) => string | undefined): string {
  let cur = start;
  const seen = new Set([start]);
  for (;;) {
    const next = childOf(cur);
    if (!next || seen.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
}

export const idleDays = (ms: number) => `${Math.floor(ms / 86_400_000)}d`;
