import type { Terminal } from "@xterm/xterm";
import { DormantRing } from "../../lib/dormant-ring";
import { chunksAfterSnapshot, type LiveChunk, type LiveSnapshot } from "./live-seq";

export interface DormantPipe {
  /** Set whether the pane is currently visible. Toggling true → false starts
   * buffering; toggling false → true drains the ring into xterm in one shot. */
  setVisible: (visible: boolean) => void;
  /** Route a PTY data chunk through the pipe. Writes directly to xterm when
   * visible, otherwise buffers in the ring. `seq`: main's output seq after it */
  push: (data: string, seq?: number) => void;
  /** Tear-down handler. After dispose() the pipe writes nothing. */
  dispose: () => void;
}

type WritableTerminal = Pick<Terminal, "write" | "reset">;

/**
 * Wires a DormantRing into a terminal so writes are buffered while the pane
 * is hidden and replayed instantly on un-hide. The hot path stays a single
 * branch: when visible, push() forwards straight to terminal.write().
 *
 * A ring that overflowed holds only the tail of the stream: a TUI redraws its screen with
 * relative cursor moves, so that tail drawn on a reset screen overlapped lines until the next
 * resize. With `fetchSnapshot` (main's emulator, which saw every byte) the pane resets to the
 * real screen instead; output that arrives meanwhile waits and follows it
 */
export function createDormantPipe(
  terminal: WritableTerminal,
  initiallyVisible: boolean,
  fetchSnapshot?: () => Promise<LiveSnapshot | null>,
): DormantPipe {
  const ring = new DormantRing();
  let visible = initiallyVisible;
  let disposed = false;
  let waiting: LiveChunk[] | null = null;

  function resync(fetch: () => Promise<LiveSnapshot | null>): void {
    // Kept for a failed fetch: the tail beats a frozen screen
    const tail = ring.drain();
    waiting = [];
    const flush = (snapshot: LiveSnapshot | null) => {
      const queued = waiting ?? [];
      waiting = null;
      if (disposed) return;
      if (snapshot?.data != null) {
        terminal.reset();
        terminal.write(snapshot.data);
      } else if (tail) {
        terminal.write(tail);
      }
      // Output that came while it was fetched: the snapshot may hold some of it already
      const { replay } = chunksAfterSnapshot(queued, snapshot?.seq ?? null);
      for (const chunk of replay) push(chunk.data, chunk.seq);
    };
    fetch().then(flush, () => flush(null));
  }

  function setVisible(next: boolean): void {
    if (disposed || next === visible) return;
    visible = next;
    if (!visible || ring.isEmpty()) return;
    if (ring.didOverflow() && fetchSnapshot) {
      // Shows up in a bug report's console section: confirms this path in the field
      console.info("[Terminal] Output overflowed while hidden: redrawn from the session snapshot");
      resync(fetchSnapshot);
      return;
    }
    const replay = ring.drain();
    if (replay.length > 0) terminal.write(replay);
  }

  function push(data: string, seq?: number): void {
    if (disposed || data.length === 0) return;
    if (waiting) {
      waiting.push({ data, seq });
    } else if (visible) {
      terminal.write(data);
    } else {
      ring.write(data);
    }
  }

  function dispose(): void {
    disposed = true;
    ring.clear();
    waiting = null;
  }

  return { setVisible, push, dispose };
}
