import type { AgentStatus } from "@exegol/shared";
import { descendantsOf } from "../system/process-tree";
import type { ProcRow } from "../system/shell-clis";

const DAY_MS = 86_400_000;
/** Before this, main saw no input or output: a shell's clock starts here, never earlier */
const trackingSince = Date.now();
const lastActivity = new Map<string, number>();

/** PTY output or user input: one Map write per chunk */
export function noteSessionActivity(agentId: string): void {
  lastActivity.set(agentId, Date.now());
}

export function pruneSessionActivity(live: ReadonlySet<string>): void {
  for (const id of lastActivity.keys()) if (!live.has(id)) lastActivity.delete(id);
}

export interface IdleSession {
  id: string;
  cliType: string;
  status: AgentStatus;
  launchedInShell: boolean;
  prWatch: boolean;
  /** Unix seconds */
  startedAt: number;
  /** ms */
  statusChangedAt: number | null;
}

export interface IdleContext {
  now: number;
  /** 0 = Off */
  days: number;
  /** Pinned in Watching or with an unread attention item (the renderer reports them) */
  exempt: ReadonlySet<string>;
  awaitingApproval: (id: string) => boolean;
  activity?: (id: string) => number | undefined;
  since?: number;
}

/** A shell, or a CLI typed in one that exited back to its prompt: judged by what the tty runs */
export const isShellLike = (s: Pick<IdleSession, "cliType" | "launchedInShell" | "status">) =>
  s.cliType === "shell" || (s.launchedInShell && s.status === "idle");

export function lastActiveAt(s: IdleSession, ctx: IdleContext): number {
  const seen = (ctx.activity ?? ((id) => lastActivity.get(id)))(s.id);
  const started = s.startedAt * 1000;
  // A shell's status never moves, so only main's own record counts for it
  if (isShellLike(s)) return Math.max(seen ?? ctx.since ?? trackingSince, started);
  return Math.max(seen ?? 0, s.statusChangedAt ?? 0, started);
}

export type IdleVerdict =
  | { kind: "agent" | "shell"; idleMs: number }
  | { kind: "skip"; idleMs: number; reason: string };

/** null: not idle long enough (or the setting is Off), nothing to say about it */
export function idleVerdict(s: IdleSession, ctx: IdleContext): IdleVerdict | null {
  if (ctx.days <= 0) return null;
  const idleMs = ctx.now - lastActiveAt(s, ctx);
  if (idleMs < ctx.days * DAY_MS) return null;
  const skip = (reason: string): IdleVerdict => ({ kind: "skip", idleMs, reason });
  if (ctx.exempt.has(s.id)) return skip("watched or needs attention");
  if (s.prWatch) return skip("pr watch");
  if (isShellLike(s)) return { kind: "shell", idleMs };
  if (s.status === "running" || s.status === "spawning") return skip("running");
  if (ctx.awaitingApproval(s.id)) return skip("needs attention");
  return { kind: "agent", idleMs };
}

const program = (args: string) =>
  (args.trim().split(/\s+/)[0] ?? "").split("/").pop()?.replace(/^-/, "") ?? "";

/** Prompt helpers that live under every shell and run nothing of the user's */
const PROMPT_HELPERS = /^gitstatusd/;

/**
 * Nothing of the user's in the terminal: the shell owns the foreground and no job runs below it
 * (a dev server sent to the background with `&` counts). Its own forks (async prompt workers)
 * and prompt helpers do not
 */
export function shellAtRest(shellPid: number, rows: ProcRow[]): boolean {
  const shell = rows.find((r) => r.pid === shellPid);
  if (!shell) return false;
  if (shell.tpgid != null && shell.pgid != null && shell.tpgid > 0 && shell.tpgid !== shell.pgid)
    return false;
  const own = program(shell.args);
  return descendantsOf(shellPid, rows).every((r) => {
    const name = program(r.args);
    return name === own || PROMPT_HELPERS.test(name);
  });
}

/** The session's process tree in MB (0 when the table does not have it) */
export function treeRssMb(pid: number | null, rows: ProcRow[]): number {
  if (!pid) return 0;
  const tree = [rows.find((r) => r.pid === pid), ...descendantsOf(pid, rows)];
  const kb = tree.reduce((sum, r) => sum + (r?.rss ?? 0), 0);
  return Math.round(kb / 1024);
}
