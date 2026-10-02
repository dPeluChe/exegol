import { childrenByParent, type ProcRow, readProcessTable } from "./shell-clis";

/** Every process below `rootPid` (children, their children...), root excluded */
export function descendantsOf(rootPid: number, rows: ProcRow[]): ProcRow[] {
  const children = childrenByParent(rows);
  const out: ProcRow[] = [];
  let level = children.get(rootPid) ?? [];
  while (level.length > 0) {
    out.push(...level);
    level = level.flatMap((r) => children.get(r.pid) ?? []);
  }
  return out;
}

/**
 * What a terminal runs besides its shell: everything on the shell's tty (foreground and
 * background jobs, prompt workers reparented to launchd) and everything below the shell that
 * left the tty. A real daemon (double fork + setsid) asked to outlive it and is not here.
 */
export function terminalProcesses(shellPid: number, rows: ProcRow[]): ProcRow[] {
  const tty = rows.find((r) => r.pid === shellPid)?.tty;
  // macOS `ttys003`, Linux `pts/3`; no terminal is "??" / "?"
  const onTty = tty && !/^[?-]+$/.test(tty) ? rows.filter((r) => r.tty === tty) : [];
  const byPid = new Map([...onTty, ...descendantsOf(shellPid, rows)].map((r) => [r.pid, r]));
  byPid.delete(shellPid);
  return [...byPid.values()];
}

const KILL_AFTER_MS = 2_000;

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
}

/** SIGTERM, then SIGKILL to the ones still the same process (pid AND command line, never a pid
 *  recycled in between) 2s later. The shell's hangup alone left SIGHUP-proof servers running */
export function terminateAll(rows: ProcRow[]): void {
  if (rows.length === 0) return;
  for (const p of rows) signal(p.pid, "SIGTERM");
  setTimeout(async () => {
    const now = new Map((await readProcessTable()).map((r) => [r.pid, r.args]));
    for (const p of rows) if (now.get(p.pid) === p.args) signal(p.pid, "SIGKILL");
  }, KILL_AFTER_MS).unref();
}
