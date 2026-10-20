import type { AgentStatus } from "@exegol/shared";
import { descendantsOf, terminalProcesses } from "../system/process-tree";
import type { ProcRow } from "../system/shell-clis";

const DAY_MS = 86_400_000;
/** Before this, main saw no input or output: a shell's clock never starts earlier */
const trackingSince = Date.now();

export interface IdleSession {
  id: string;
  cliType: string;
  status: AgentStatus;
  launchedInShell: boolean;
  prWatch: boolean;
  /** In a parallel run, or a pipeline/queue waits on its exit */
  driven: boolean;
  /** Unix seconds */
  startedAt: number;
  /** ms */
  statusChangedAt: number | null;
  /** ms, agents.last_activity_at (throttled copy of input/output) */
  lastActivityAt: number | null;
}

export interface IdleContext {
  now: number;
  /** 0 = Off */
  days: number;
  /** Pinned in Watching or with an unread attention item (the renderer reports them) */
  exempt: ReadonlySet<string>;
  awaitingApproval: (id: string) => boolean;
  /** A numbered question (permission prompt) on the session's screen */
  questionOnScreen: (id: string) => boolean;
  /** Last input or output main saw this run */
  activity: (id: string) => number | undefined;
  since?: number;
}

/** A shell, or a CLI typed in one that exited back to its prompt: judged by what the tty runs */
export const isShellLike = (s: Pick<IdleSession, "cliType" | "launchedInShell" | "status">) =>
  s.cliType === "shell" || (s.launchedInShell && s.status === "idle");

export function lastActiveAt(s: IdleSession, ctx: IdleContext): number {
  const seen = ctx.activity(s.id) ?? 0;
  const started = s.startedAt * 1000;
  // A shell's status never moves: without a persisted time its clock starts with main
  if (isShellLike(s))
    return Math.max(seen, s.lastActivityAt ?? ctx.since ?? trackingSince, started);
  return Math.max(seen, s.lastActivityAt ?? 0, s.statusChangedAt ?? 0, started);
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
  if (s.driven) return skip("pipeline, queue or parallel run");
  if (isShellLike(s)) return { kind: "shell", idleMs };
  if (s.status === "running" || s.status === "spawning") return skip("running");
  if (ctx.awaitingApproval(s.id) || ctx.questionOnScreen(s.id)) return skip("needs attention");
  return { kind: "agent", idleMs };
}

/** Prompt helpers that live under every shell and run nothing of the user's (powerlevel10k) */
const PROMPT_HELPER = /^(\S*\/)?gitstatusd\S*(\s|$)/;

/**
 * Nothing of the user's in the terminal, judged on the set a close would terminate
 * (`terminalProcesses`): only the shell's own forks (same command line, no children) and
 * prompt helpers. `cli` (a CLI typed in it) is left out of the judgment
 */
export function shellAtRest(shellPid: number, rows: ProcRow[], cli?: ReadonlySet<number>): boolean {
  const shell = rows.find((r) => r.pid === shellPid);
  if (!shell) return false;
  const fg = shell.tpgid ?? 0;
  if (!cli && fg > 0 && fg !== shell.pgid) return false;
  const parents = new Set(rows.map((r) => r.ppid));
  return terminalProcesses(shellPid, rows)
    .filter((r) => !cli?.has(r.pid))
    .every(
      (r) =>
        !parents.has(r.pid) && (r.args === shell.args || PROMPT_HELPER.test(r.args.trimStart())),
    );
}

const subtree = (pid: number, rows: ProcRow[]) =>
  new Set([pid, ...descendantsOf(pid, rows).map((r) => r.pid)]);

/**
 * An agent's terminal runs something besides its CLI (and the CLI's own children, MCP servers
 * included), or something in it listens on a TCP port (a dev server it started)
 */
export function agentBusy(pid: number, rows: ProcRow[], listening: ReadonlySet<number>): boolean {
  if (!rows.some((r) => r.pid === pid)) return true;
  const cli = subtree(pid, rows);
  const all = [...cli, ...terminalProcesses(pid, rows).map((r) => r.pid)];
  return all.some((p) => !cli.has(p) || listening.has(p));
}

/** A CLI typed in a shell, still running: the shell rule on the shell minus the CLI's group */
export function typedCliBusy(
  shellPid: number,
  rows: ProcRow[],
  listening: ReadonlySet<number>,
): boolean {
  const shell = rows.find((r) => r.pid === shellPid);
  const fg = shell?.tpgid ?? 0;
  if (!shell || fg <= 0 || fg === shell.pgid) return true;
  const cli = new Set<number>();
  for (const r of rows) if (r.pgid === fg) for (const p of subtree(r.pid, rows)) cli.add(p);
  const all = [shellPid, ...terminalProcesses(shellPid, rows).map((r) => r.pid)];
  return !shellAtRest(shellPid, rows, cli) || all.some((p) => listening.has(p));
}

/** The session's process tree in MB (0 when the table does not have it) */
export function treeRssMb(pid: number | null, rows: ProcRow[]): number {
  if (!pid) return 0;
  const tree = [rows.find((r) => r.pid === pid), ...descendantsOf(pid, rows)];
  const kb = tree.reduce((sum, r) => sum + (r?.rss ?? 0), 0);
  return Math.round(kb / 1024);
}
