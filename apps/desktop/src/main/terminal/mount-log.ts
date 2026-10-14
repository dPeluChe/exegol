/** What a terminal view reports when it mounts or unmounts: sizes, counts and times only */
export interface TermMountStats {
  kind: "mount" | "unmount";
  snapshotBytes: number;
  snapshotMs: number;
  paintMs: number | null;
  snapGrid: string | null;
  fitGrid: string | null;
  replayed: number;
  dropped: number;
  kick: boolean;
}

const AGENT_ID = /^[\w-]{1,64}$/;
const GRID = /^\d{1,4}x\d{1,4}$/;

function count(n: unknown, max = 1e9): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
}

function grid(g: unknown): string | null | undefined {
  if (g === null) return null;
  return typeof g === "string" && GRID.test(g) ? g : undefined;
}

/** The renderer is untrusted: anything that is not a plain count or grid drops the line */
export function parseMountStats(agentId: unknown, input: unknown): TermMountStats | null {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return null;
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const snapGrid = grid(r.snapGrid);
  const fitGrid = grid(r.fitGrid);
  if (r.kind !== "mount" && r.kind !== "unmount") return null;
  if (snapGrid === undefined || fitGrid === undefined) return null;
  if (!count(r.snapshotBytes) || !count(r.snapshotMs, 1e7)) return null;
  if (!count(r.replayed, 1e7) || !count(r.dropped, 1e7) || typeof r.kick !== "boolean") return null;
  if (r.paintMs !== null && !count(r.paintMs, 1e7)) return null;
  return {
    kind: r.kind,
    snapshotBytes: Math.round(r.snapshotBytes),
    snapshotMs: Math.round(r.snapshotMs),
    paintMs: r.paintMs === null ? null : Math.round(r.paintMs as number),
    snapGrid,
    fitGrid,
    replayed: Math.round(r.replayed),
    dropped: Math.round(r.dropped),
    kick: r.kick,
  };
}

export function formatMountLine(agentId: string, s: TermMountStats): string {
  if (s.kind === "unmount") return `[TermMount] ${agentId} unmount`;
  const paint = s.paintMs === null ? "" : ` paint ${s.paintMs}ms`;
  return (
    `[TermMount] ${agentId} mount snapshot ${s.snapshotBytes}B ${s.snapshotMs}ms` +
    ` grid ${s.snapGrid ?? "none"} -> ${s.fitGrid ?? "unmeasured"}` +
    ` replayed ${s.replayed} dropped ${s.dropped} kick ${s.kick ? "yes" : "no"}${paint}`
  );
}
