import type { IBufferRange, IDisposable, Terminal } from "@xterm/xterm";
import { IS_MAC } from "../../lib/keymap";

/** A gesture this recent cleared the selection on purpose */
const GESTURE_MS = 400;

/** Cells from start to end of a selection, the `length` of `Terminal.select` */
export function selectionLength(range: IBufferRange, cols: number): number {
  return (range.end.y - range.start.y) * cols + (range.end.x - range.start.x);
}

/** A press that opens the context menu: the right button, or Ctrl+click on macOS */
export function isMenuClick(e: { button: number; ctrlKey: boolean }, mac = IS_MAC): boolean {
  return e.button === 2 || (mac && e.button === 0 && e.ctrlKey);
}

/** A menu click over a selection must not reach xterm: it would report it to a mouse-tracking TUI
 *  (input clears the selection) or start a new selection, and the menu would lose the text */
export function shouldShieldSelection(
  e: { button: number; ctrlKey: boolean },
  hasSelection: boolean,
  mac = IS_MAC,
): boolean {
  return hasSelection && isMenuClick(e, mac);
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

/** Keeps an Option+drag selection alive under a mouse-tracking TUI until a click, key or wheel, and
 *  through a right-click so the context menu's Send to gets it */
export function keepSelection(terminal: Terminal, element: HTMLElement): IDisposable {
  let saved: IBufferRange | null = null;
  let lastGestureAt = 0;
  const gesture = (e: Event) => {
    if (e instanceof MouseEvent && isMenuClick(e)) return;
    lastGestureAt = Date.now();
  };
  const shieldPress = (e: MouseEvent) => {
    if (shouldShieldSelection(e, terminal.hasSelection())) e.stopImmediatePropagation();
  };
  // xterm's contextmenu handler selects the word under the pointer; the event itself must still
  // bubble to the pane's menu, so only the option flips
  const shieldMenu = () => {
    terminal.options.rightClickSelectsWord = IS_MAC && !terminal.hasSelection();
  };
  const events = ["mousedown", "keydown", "wheel"] as const;
  for (const name of events) element.addEventListener(name, gesture, true);
  element.addEventListener("mousedown", shieldPress, true);
  element.addEventListener("contextmenu", shieldMenu, true);
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
      element.removeEventListener("mousedown", shieldPress, true);
      element.removeEventListener("contextmenu", shieldMenu, true);
    },
  };
}
