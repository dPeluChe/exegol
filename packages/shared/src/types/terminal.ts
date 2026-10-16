/** A session's screen for a mounting view (`terminal:get-snapshot`) */
export interface LiveSnapshot {
  data: string | null;
  /** Seq of the last output it holds; absent when unknown, so a view keeps every buffered chunk */
  seq?: number;
  cols: number;
  rows: number;
  /** Drawn in the alternate screen */
  alt?: boolean;
}

/** `terminal:mount-log`, logged by main as `[TermMount]`: sizes, counts and times, never content */
export type MountStats =
  | { kind: "unmount" }
  | {
      kind: "mount";
      snapshotBytes: number;
      snapshotMs: number;
      paintMs: number;
      snapGrid: string | null;
      fitGrid: string;
      replayed: number;
      dropped: number;
      kick: boolean;
    }
  /** The view's grid moved after the mount line (layout still settling): `changes` refits that
   *  changed it, the last one `afterMs` after the mount */
  | { kind: "settle"; mountGrid: string; finalGrid: string; afterMs: number; changes: number };

export function gridLabel(cols: number, rows: number): string {
  return `${cols}x${rows}`;
}
