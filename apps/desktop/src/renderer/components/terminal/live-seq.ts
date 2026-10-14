/** A session's screen for a mounting view: `seq` is the last output chunk it holds */
export interface LiveSnapshot {
  data: string | null;
  seq: number | null;
  cols: number;
  rows: number;
}

export interface LiveChunk {
  data: string;
  seq?: number;
}

/** Sent to main's `[TermMount]` line: sizes, counts and times, never content */
export interface MountStats {
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

/** A chunk the snapshot already holds: writing it again duplicated characters on screen */
export function heldBySnapshot(seq: number | undefined, snapSeq: number | null): boolean {
  return seq !== undefined && snapSeq !== null && seq <= snapSeq;
}

/** The chunks buffered while the snapshot was in flight that still need writing, in order */
export function chunksAfterSnapshot(
  buffered: LiveChunk[],
  snapSeq: number | null,
): { replay: LiveChunk[]; dropped: number } {
  const replay = buffered.filter((c) => !heldBySnapshot(c.seq, snapSeq));
  return { replay, dropped: buffered.length - replay.length };
}

export function gridLabel(cols: number, rows: number): string {
  return `${cols}x${rows}`;
}

/**
 * How a (re)mounted pane gets its program to repaint. A fitted grid that differs from the
 * snapshot's sends a PTY resize anyway, which every TUI redraws on; the same grid in the
 * alternate screen needs the redraw jiggle. Mirrors and read-only views never ask.
 */
export function mountRepaint(args: {
  owner: boolean;
  alternate: boolean;
  snap: { cols: number; rows: number } | null;
  fit: { cols: number; rows: number };
}): "resize" | "kick" | "none" {
  if (!args.owner) return "none";
  const { snap, fit } = args;
  if (snap && (snap.cols !== fit.cols || snap.rows !== fit.rows)) return "resize";
  return args.alternate ? "kick" : "none";
}

/** Drawn only when its box intersects the viewport AND no ancestor hides it */
export function isOnScreen(intersecting: boolean, shown: boolean): boolean {
  return intersecting && shown;
}
