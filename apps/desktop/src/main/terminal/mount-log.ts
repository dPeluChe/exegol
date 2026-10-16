import type { MountStats } from "@exegol/shared";
import { createLogLimiter } from "../lib/log-limiter";

export const AGENT_ID = /^[\w-]{1,64}$/;
const GRID = /^\d{1,4}x\d{1,4}$/;

/** Per-session limits for the terminal view lines: `[TermMount]`, `[Visible]`, `[Resize]` */
export const mountLogLimit = createLogLimiter(1_000);
export const visibleLogLimit = createLogLimiter(1_000);
export const resizeLogLimit = createLogLimiter(10_000);

/** A settle line follows its mount within the second: limited on its own key, not dropped */
export const mountLogKey = (m: MountLog) =>
  m.kind === "settle" ? `${m.agentId}:settle` : m.agentId;

export function forgetTerminalLogs(agentId: string): void {
  mountLogLimit.forget(agentId);
  mountLogLimit.forget(`${agentId}:settle`);
  visibleLogLimit.forget(agentId);
  resizeLogLimit.forget(agentId);
}

export type MountLog = MountStats & { agentId: string };

function count(n: unknown, max = 1e9): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
}

const isGrid = (g: unknown): g is string => typeof g === "string" && GRID.test(g);

/** The renderer is untrusted: anything that is not a plain count or grid drops the line */
export function parseMountStats(agentId: unknown, input: unknown): MountLog | null {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return null;
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (r.kind === "unmount") return { agentId, kind: "unmount" };
  if (r.kind === "settle") {
    const { mountGrid, finalGrid, afterMs, changes } = r;
    if (!isGrid(mountGrid) || !isGrid(finalGrid) || !count(afterMs, 1e7) || !count(changes, 1e4)) {
      return null;
    }
    return {
      agentId,
      kind: "settle",
      mountGrid,
      finalGrid,
      afterMs: Math.round(afterMs),
      changes: Math.round(changes),
    };
  }
  if (r.kind !== "mount") return null;
  const { snapGrid, fitGrid, snapshotBytes, snapshotMs, paintMs, replayed, dropped, kick } = r;
  if ((snapGrid !== null && !isGrid(snapGrid)) || !isGrid(fitGrid)) return null;
  if (!count(snapshotBytes) || !count(snapshotMs, 1e7) || !count(paintMs, 1e7)) return null;
  if (!count(replayed, 1e7) || !count(dropped, 1e7) || typeof kick !== "boolean") return null;
  return {
    agentId,
    kind: "mount",
    snapshotBytes: Math.round(snapshotBytes),
    snapshotMs: Math.round(snapshotMs),
    paintMs: Math.round(paintMs),
    snapGrid,
    fitGrid,
    replayed: Math.round(replayed),
    dropped: Math.round(dropped),
    kick,
  };
}

export function formatMountLine(m: MountLog): string {
  if (m.kind === "unmount") return `[TermMount] ${m.agentId} unmount`;
  if (m.kind === "settle") {
    return `[TermMount] ${m.agentId} settled ${m.mountGrid} -> ${m.finalGrid} after ${m.afterMs}ms (${m.changes} change${m.changes === 1 ? "" : "s"})`;
  }
  return (
    `[TermMount] ${m.agentId} mount snapshot ${m.snapshotBytes}B ${m.snapshotMs}ms` +
    ` grid ${m.snapGrid ?? "none"} -> ${m.fitGrid}` +
    ` replayed ${m.replayed} dropped ${m.dropped} kick ${m.kick ? "yes" : "no"} paint ${m.paintMs}ms`
  );
}
