import type { IBufferRange, IDisposable, Terminal } from "@xterm/xterm";

/** A gesture this recent cleared the selection on purpose */
const GESTURE_MS = 400;

/** Cells from start to end of a selection, the `length` of `Terminal.select` */
export function selectionLength(range: IBufferRange, cols: number): number {
  return (range.end.y - range.start.y) * cols + (range.end.x - range.start.x);
}

/** Whether a cleared selection should come back: a TUI tracking the mouse gets every mouse move as
 *  input, and xterm drops the selection on any input, so moving to Send to would lose it */
export function shouldRestore(
  saved: IBufferRange | null,
  mouseTracking: boolean,
  lastGestureAt: number,
  now: number,
): boolean {
  return saved !== null && mouseTracking && now - lastGestureAt > GESTURE_MS;
}

/** Keeps an Option+drag selection alive under a mouse-tracking TUI until a click, key or wheel */
export function keepSelection(terminal: Terminal, element: HTMLElement): IDisposable {
  let saved: IBufferRange | null = null;
  let lastGestureAt = 0;
  const gesture = () => {
    lastGestureAt = Date.now();
  };
  const events = ["mousedown", "keydown", "wheel"] as const;
  for (const name of events) element.addEventListener(name, gesture, true);
  const sub = terminal.onSelectionChange(() => {
    if (terminal.hasSelection()) {
      saved = terminal.getSelectionPosition() ?? null;
      return;
    }
    const range = saved;
    saved = null;
    const tracking = terminal.modes.mouseTrackingMode !== "none";
    if (range && shouldRestore(range, tracking, lastGestureAt, Date.now())) {
      terminal.select(range.start.x, range.start.y, selectionLength(range, terminal.cols));
    }
  });
  return {
    dispose: () => {
      sub.dispose();
      for (const name of events) element.removeEventListener(name, gesture, true);
    },
  };
}
