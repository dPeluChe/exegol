/**
 * How a terminal fills its pane, which is a different question for a shell than
 * for a TUI.
 *
 * A shell scrolls: leftover pixels at the bottom are a harmless margin, so the
 * cell grid is floored and the remainder ignored. A full-screen TUI does not
 * scroll — it paints exactly `rows × cols` — so the same flooring leaves a dead
 * gutter along the bottom and right of every Gemini, OpenCode, Kiro and Crush
 * pane we open. Ceiling the grid instead and stretching the cell to cover the
 * host removes it.
 */

export interface CellMetrics {
  /** Width of one character cell at the current font, in px. */
  width: number;
  /** Height of one line at the current font, in px. */
  height: number;
}

export interface FitResult {
  cols: number;
  rows: number;
  /** Multipliers to apply to xterm's letterSpacing / lineHeight. 1 = unchanged. */
  letterSpacing: number;
  lineHeight: number;
}

/** Below this a "fit" is meaningless — the container is mid-layout. */
const MIN_DIMENSION_PX = 8;
const MIN_CELLS = 2;
/** Past this the glyphs distort more than the gutter offends. */
const MAX_STRETCH = 1.25;

/**
 * @param mode `alternate` when the app is on the alt screen (a TUI), else
 *   `normal`. xterm reports this as `terminal.buffer.active.type`.
 */
export function computeFit(
  host: { width: number; height: number },
  cell: CellMetrics,
  mode: "normal" | "alternate",
): FitResult | null {
  if (
    host.width < MIN_DIMENSION_PX ||
    host.height < MIN_DIMENSION_PX ||
    cell.width <= 0 ||
    cell.height <= 0
  ) {
    return null;
  }

  const round = mode === "alternate" ? Math.ceil : Math.floor;
  const cols = Math.max(MIN_CELLS, round(host.width / cell.width));
  const rows = Math.max(MIN_CELLS, round(host.height / cell.height));

  if (mode === "normal") {
    return { cols, rows, letterSpacing: 1, lineHeight: 1 };
  }

  // Ceiling means the grid is now slightly WIDER than the host; stretching the
  // cell the other way would overflow. Only stretch when ceiling rounded down
  // to a grid that under-fills — i.e. clamp at 1 and never above MAX_STRETCH,
  // so a near-exact fit is left alone rather than distorted for a pixel.
  return {
    cols,
    rows,
    letterSpacing: stretch(host.width / cols, cell.width),
    lineHeight: stretch(host.height / rows, cell.height),
  };
}

function stretch(available: number, actual: number): number {
  const ratio = available / actual;
  if (!Number.isFinite(ratio) || ratio <= 1) return 1;
  return Math.min(ratio, MAX_STRETCH);
}
