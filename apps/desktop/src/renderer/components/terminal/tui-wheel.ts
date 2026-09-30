/** xterm scales a trackpad's small wheel deltas (< 50 px) by 0.3 before turning them into wheel
 *  clicks for a TUI that tracks the mouse: about fifteen events per click, so a swipe barely
 *  scrolls Claude. This undoes that damping while mouse reports go out */
const TUI_WHEEL_SENSITIVITY = 3;

interface WheelTerminal {
  modes: { mouseTrackingMode: string };
  options: { scrollSensitivity?: number };
}

/** Call from the custom wheel handler (it runs before xterm reads the event). The terminal's own
 *  scrollback keeps 1: only a TUI that asked for the mouse gets the boost */
export function tuneWheelSensitivity(terminal: WheelTerminal): void {
  const want = terminal.modes.mouseTrackingMode !== "none" ? TUI_WHEEL_SENSITIVITY : 1;
  if (terminal.options.scrollSensitivity !== want) terminal.options.scrollSensitivity = want;
}
