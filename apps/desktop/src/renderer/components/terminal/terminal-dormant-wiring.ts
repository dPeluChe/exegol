import type { Terminal } from "@xterm/xterm";
import { DormantRing } from "../../lib/dormant-ring";

export interface DormantPipe {
  /** Set whether the pane is currently visible. Toggling true → false starts
   * buffering; toggling false → true drains the ring into xterm in one shot. */
  setVisible: (visible: boolean) => void;
  /** Route a PTY data chunk through the pipe. Writes directly to xterm when
   * visible, otherwise buffers in the ring. */
  push: (data: string) => void;
  /** Tear-down handler. After dispose() the pipe writes nothing. */
  dispose: () => void;
}

/**
 * Wires a DormantRing into a terminal so writes are buffered while the pane
 * is hidden and replayed instantly on un-hide. The hot path stays a single
 * branch: when visible, push() forwards straight to terminal.write().
 */
export function createDormantPipe(terminal: Terminal, initiallyVisible: boolean): DormantPipe {
  const ring = new DormantRing();
  let visible = initiallyVisible;
  let disposed = false;

  function setVisible(next: boolean): void {
    if (disposed || next === visible) return;
    visible = next;
    if (visible && !ring.isEmpty()) {
      const replay = ring.drain();
      if (replay.length > 0) terminal.write(replay);
    }
  }

  function push(data: string): void {
    if (disposed || data.length === 0) return;
    if (visible) {
      terminal.write(data);
    } else {
      ring.write(data);
    }
  }

  function dispose(): void {
    disposed = true;
    ring.clear();
  }

  return { setVisible, push, dispose };
}
