import type { LiveSnapshot } from "@exegol/shared";

export interface LiveChunk {
  data: string;
  seq?: number;
}

/** A chunk the snapshot already holds: writing it again duplicated characters on screen */
export function heldBySnapshot(seq: number | undefined, snapSeq: number | undefined): boolean {
  return seq !== undefined && snapSeq !== undefined && seq <= snapSeq;
}

/** The chunks buffered while the snapshot was in flight that still need writing, in order */
export function chunksAfterSnapshot(
  buffered: LiveChunk[],
  snapSeq: number | undefined,
): { replay: LiveChunk[]; dropped: number } {
  const replay = buffered.filter((c) => !heldBySnapshot(c.seq, snapSeq));
  return { replay, dropped: buffered.length - replay.length };
}

export const LIVE_BUFFER_CAP = 2 * 1024 * 1024;

/** Output that races a snapshot request. Past `cap` it keeps nothing: a fresh snapshot holds it */
export function createLiveBuffer(cap = LIVE_BUFFER_CAP) {
  let chunks: LiveChunk[] = [];
  let size = 0;
  let overflowed = false;
  return {
    push(chunk: LiveChunk): void {
      if (overflowed) return;
      size += chunk.data.length;
      if (size > cap) {
        overflowed = true;
        chunks = [];
        return;
      }
      chunks.push(chunk);
    },
    /** What it holds, or null after an overflow (ask for a new snapshot); it starts over empty */
    take(): LiveChunk[] | null {
      const out = overflowed ? null : chunks;
      chunks = [];
      size = 0;
      overflowed = false;
      return out;
    },
  };
}

/** The alt screen never reflows, so a TUI frame is written at the grid it was drawn at; the
 *  normal buffer reflows on the next fit (resizing it first reflowed the scrollback twice) */
export function resizeToSnapshot(
  terminal: { cols: number; rows: number; resize: (cols: number, rows: number) => void },
  snapshot: LiveSnapshot | null,
): void {
  if (!snapshot?.alt) return;
  if (terminal.cols !== snapshot.cols || terminal.rows !== snapshot.rows) {
    terminal.resize(snapshot.cols, snapshot.rows);
  }
}

/** A snapshot this small of an alt screen is a TUI that has not drawn for this model yet */
export const TINY_SNAPSHOT_BYTES = 256;

/**
 * How a (re)mounted pane gets its program to repaint. A fitted grid that differs from the
 * snapshot's sends a PTY resize, which every TUI redraws on. At the same grid the snapshot is
 * exact, so only an alt screen that came back (nearly) empty, or a session's first mount in this
 * renderer, gets the redraw jiggle. A mirror asks too (a pinned session after a restart may have
 * no pane to do it, and its model came from the ring's tail); read-only views never ask.
 */
export function mountRepaint(args: {
  live: boolean;
  alternate: boolean;
  firstMount: boolean;
  snapshotBytes: number;
  snap: { cols: number; rows: number } | null;
  fit: { cols: number; rows: number };
}): "resize" | "kick" | "none" {
  if (!args.live) return "none";
  const { snap, fit } = args;
  if (snap && (snap.cols !== fit.cols || snap.rows !== fit.rows)) return "resize";
  if (!args.alternate) return "none";
  return args.firstMount || args.snapshotBytes < TINY_SNAPSHOT_BYTES ? "kick" : "none";
}
