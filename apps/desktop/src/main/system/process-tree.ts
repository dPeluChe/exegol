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

const KILL_AFTER_MS = 2_000;

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
}

/**
 * The processes a terminal started, read while its shell still holds them. Closing the terminal
 * hangs up its shell, but a dev server that ignores SIGHUP or a job sent to the background
 * outlives it, orphaned: these get SIGTERM, then SIGKILL if still the same process 2s later.
 */
export async function processesBelow(rootPid: number): Promise<{ terminate: () => void } | null> {
  const tree = descendantsOf(rootPid, await readProcessTable());
  if (tree.length === 0) return null;
  return {
    terminate: () => {
      for (const p of tree) signal(p.pid, "SIGTERM");
      setTimeout(async () => {
        const now = new Map((await readProcessTable()).map((r) => [r.pid, r.args]));
        // Same pid AND command line: never a pid recycled in between
        for (const p of tree) if (now.get(p.pid) === p.args) signal(p.pid, "SIGKILL");
      }, KILL_AFTER_MS).unref();
    },
  };
}
