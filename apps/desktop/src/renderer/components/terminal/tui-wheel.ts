/** xterm scales a trackpad's small wheel deltas (< 50 px) by 0.3 before turning them into wheel
 *  clicks for a TUI that tracks the mouse: about fifteen events per click, so a swipe barely
 *  scrolls Claude. This undoes that damping while mouse reports go out */
const TUI_WHEEL_SENSITIVITY = 3;
/** Same threshold xterm uses to tell a trackpad from a wheel notch */
const TRACKPAD_DELTA_PX = 50;

interface WheelTerminal {
  modes: { mouseTrackingMode: string };
  options: { scrollSensitivity?: number };
}

type WheelDelta = Pick<WheelEvent, "deltaMode" | "deltaY">;

/** Call from the custom wheel handler (it runs before xterm reads the event). The terminal's own
 *  scrollback and mouse wheel notches keep 1: only trackpad deltas to a TUI get the boost */
export function tuneWheelSensitivity(terminal: WheelTerminal, e: WheelDelta): void {
  const trackpad = e.deltaMode === 0 && Math.abs(e.deltaY) < TRACKPAD_DELTA_PX;
  const want = trackpad && terminal.modes.mouseTrackingMode !== "none" ? TUI_WHEEL_SENSITIVITY : 1;
  if (terminal.options.scrollSensitivity !== want) terminal.options.scrollSensitivity = want;
}
