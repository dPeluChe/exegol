// Exits the sidecar caused by stopping, not the CLIs' own: they must not be finalized as failed,
// scored or cleaned up. A notice names them; without one (SIGKILL, OOM) an exit that arrives
// within a second of another waits to see whether the socket dies too.

export const BURST_WINDOW_MS = 1000;
export const GONE_WITHOUT_NOTICE = "gone without notice";

export type ExitKind = "lost" | "hold" | "normal";

/** Pure: noticed sessions are lost; an exit close behind another waits; a lone one is the CLI's */
export function exitKind(noticed: boolean, exitsInWindow: number): ExitKind {
  if (noticed) return "lost";
  return exitsInWindow > 0 ? "hold" : "normal";
}

export class SidecarLossTracker {
  private readonly noticed = new Map<string, string>();
  private recentExits: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  notice(reason: string, ids: string[]): void {
    for (const id of ids) this.noticed.set(id, reason);
  }

  reasonFor(id: string): string | undefined {
    return this.noticed.get(id);
  }

  /** Classifies an exit and records it for the burst window */
  onExit(id: string): ExitKind {
    const now = this.now();
    this.recentExits = this.recentExits.filter((t) => now - t < BURST_WINDOW_MS);
    const kind = exitKind(this.noticed.has(id), this.recentExits.length);
    this.recentExits.push(now);
    return kind;
  }

  forget(id: string): void {
    this.noticed.delete(id);
  }
}
