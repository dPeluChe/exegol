type Grid = { cols: number; rows: number };

/** The CLI's repaint after the resize is done once its output pauses this long */
export const REPAINT_QUIET_MS = 120;
/** A CLI that never repaints still shows up, at the reflowed frame */
export const REPAINT_CAP_MS = 1500;

/**
 * The ring was parsed at the PTY's stored grid. When the pane asked for another size, the model
 * is reflowed to it: a shell's lines survive that, a TUI's frame (main or alternate screen) comes
 * out split and wrapped until the CLI repaints, so its pane waits for that repaint.
 */
export function awaitsRepaint(
  model: Grid,
  target: Grid | undefined,
  session: { tui: boolean; alternateScreen: boolean },
): boolean {
  if (!target) return false;
  if (target.cols === model.cols && target.rows === model.rows) return false;
  return session.tui || session.alternateScreen;
}
