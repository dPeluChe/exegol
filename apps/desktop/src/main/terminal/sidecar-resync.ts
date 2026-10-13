// Output frames carry a per-session seq (sidecar 1.7.0): main keeps the last one it applied, so
// a Retry socket swap knows which sessions lost frames on the old socket and rebuilds only those,
// and a reattach drops the frames its ring snapshot already holds.
import { broadcast } from "../lib/event-bus";
import { HeadlessEmulator } from "./headless-emulator";
import type { Session } from "./pty-session-types";
import type { SidecarClient } from "./pty-sidecar-client";
import { whileSidecarBulk } from "./sidecar-health-watch";

export interface HeldFrame {
  data: string;
  seq?: number;
}

/** Pure: a frame main already applied */
export function isStaleFrame(lastSeq: number | undefined, seq: number | undefined): boolean {
  return seq !== undefined && lastSeq !== undefined && seq <= lastSeq;
}

/** Pure: frames were skipped between the last applied one and this one */
export function isFrameGap(lastSeq: number | undefined, seq: number | undefined): boolean {
  return seq !== undefined && lastSeq !== undefined && seq > lastSeq + 1;
}

/** Pure: after a swap, the sidecar sent frames main never applied (unknown seq: assume so) */
export function lostFrames(
  lastSeq: number | undefined,
  sentSeq: number | undefined,
  gap: boolean,
): boolean {
  if (gap || sentSeq === undefined || lastSeq === undefined) return true;
  return lastSeq < sentSeq;
}

/** Pure: the held frames a snapshot holding frames up to `ringSeq` does not include */
export function framesAfter(held: HeldFrame[], ringSeq: number | undefined): HeldFrame[] {
  if (ringSeq === undefined) return held;
  return held.filter((f) => f.seq === undefined || f.seq > ringSeq);
}

/**
 * Rebuild one session's model from the ring after a swap. Output read before the ring's reply is
 * in it; output after it is replayed on top. Views reset (RIS) and repaint in the same stream, as
 * the visibility repaint does.
 */
export async function resyncFromRing(
  s: Session,
  client: SidecarClient,
  isCurrent: () => boolean,
): Promise<void> {
  const ring = await whileSidecarBulk(client.snapshot(s.id)).catch(() => null);
  if (ring?.data == null || !isCurrent() || s.resyncTail) return;
  const tail: string[] = [];
  s.resyncTail = tail;
  const { cols, rows } = s.emulator.size;
  const fresh = new HeadlessEmulator(cols, rows);
  try {
    await fresh.writeParsed(ring.data);
  } finally {
    s.resyncTail = undefined;
  }
  if (!isCurrent()) {
    fresh.dispose();
    return;
  }
  const size = s.emulator.size;
  if (size.cols !== cols || size.rows !== rows) fresh.resize(size.cols, size.rows);
  const snapshot = (fresh.snapshot() ?? "") + fresh.modeSequence();
  for (const chunk of tail) fresh.write(chunk);
  s.emulator.dispose();
  s.emulator = fresh;
  if (ring.seq !== undefined) s.lastSeq = Math.max(s.lastSeq ?? 0, ring.seq);
  s.seqGap = false;
  broadcast("terminal:data", s.id, `\x1bc${snapshot}${tail.join("")}`);
}
