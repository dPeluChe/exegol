import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { createResizeStabilizer } from "./resize-stabilizer";

/**
 * Fit the terminal and broadcast the new size to PTY + store. Wrapped so the
 * many callers in TerminalInstance don't each have to repeat the try/catch.
 *
 * Always the addon's floored grid. An alt-screen variant used to CEIL the rows
 * and meant to squeeze the line height to compensate, but the squeeze was a
 * no-op: every fit left the grid one row taller than its box, the box grew to
 * hold it, and the next fit added another row, so the PTY kept gaining rows
 * nobody could see (Claude's input box ended up below the edge) (T194 logs).
 */
export function fitAndSyncSize(
  terminal: Terminal,
  fitAddon: FitAddon,
  agentId: string,
  readOnly: boolean,
  onSize: (cols: number, rows: number) => void,
): boolean {
  try {
    const host = measureHost(terminal);
    // Unlaid-out or hidden (display: none) box, or cells not measured yet: the addon would fall
    // back to 80x24 and the PTY would redraw (and rewrap) at 80 columns for a frame
    if (!host?.width || !host?.height) return false;
    const dims = fitAddon.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false;
    fitAddon.fit();
    const { cols, rows } = terminal;
    onSize(cols, rows);
    if (!readOnly) ptyResizes.request(agentId, terminal, cols, rows);
    return true;
  } catch {
    /* container may not be ready */
    return false;
  }
}

export const ptyResizes = createResizeStabilizer((agentId, cols, rows) =>
  window.api.terminal.resize(agentId, cols, rows),
);

/** A view that unmounts or hides drops the size it was settling: a transient layout size
 *  reached the PTY after the user had already left. True when there was one */
export function cancelPtyResize(agentId: string, terminal: Terminal): boolean {
  return ptyResizes.cancel(agentId, terminal);
}

/** Latest fit per terminal: a newer call makes older rAF retry chains exit, so
 *  two chains measuring a width that lags a frame can't shrink it twice. */
const mirrorFitGeneration = new WeakMap<Terminal, number>();

/**
 * T194: a mirror renders at the PTY's real grid, so output wraps exactly as in
 * the owning pane, and shrinks its font to fit the card instead of resizing.
 */
export function fitMirror(terminal: Terminal, baseFontSize: number): void {
  const generation = (mirrorFitGeneration.get(terminal) ?? 0) + 1;
  mirrorFitGeneration.set(terminal, generation);
  const step = (attempt: number) => {
    if (mirrorFitGeneration.get(terminal) !== generation) return;
    try {
      const host = measureHost(terminal);
      // The painted grid, not xterm's internal cell metrics: those may not exist
      // yet, and a mirror that never measures keeps its full font and overflows
      const rect = terminal.element
        ?.querySelector<HTMLElement>(".xterm-screen")
        ?.getBoundingClientRect();
      if (host?.width && host.height && rect?.width && rect.height) {
        const current = terminal.options.fontSize ?? baseFontSize;
        const drawn = { width: rect.width, height: rect.height };
        const next = nextMirrorFont(current, drawn, host, baseFontSize);
        if (next === null) return;
        terminal.options.fontSize = next;
      }
    } catch {
      /* container may not be ready */
    }
    // Unmeasured, or glyph metrics settle a frame after a font change
    if (attempt < 10) requestAnimationFrame(() => step(attempt + 1));
  };
  step(0);
}

/**
 * Next font for a mirror, or null when it should stay put. Glyph sizes round
 * to device pixels, so the painted grid moves in steps: jumping by ratio
 * alone overshot the size that fits and flip-flopped forever, and every font
 * change rebuilds xterm's glyph atlas (~50ms a frame, the renderer never went
 * idle). Overflow always shrinks strictly, fitting is final, and only a card
 * with lots of room left grows, so the sequence always ends.
 */
export function nextMirrorFont(
  current: number,
  drawn: { width: number; height: number },
  host: { width: number; height: number },
  base: number,
): number | null {
  // The tighter of the two dimensions decides: a full-height card is usually
  // width-bound, a wide one height-bound
  const ratio = Math.min(host.width / drawn.width, host.height / drawn.height);
  const byRatio = Math.floor(current * ratio * 4) / 4;
  if (drawn.width > host.width + 1 || drawn.height > host.height + 1) {
    const next = Math.max(6, Math.min(current - 0.25, byRatio));
    return next < current ? next : null;
  }
  const loose = drawn.width < host.width * 0.75 && drawn.height < host.height * 0.75;
  if (loose && current < base) {
    const next = Math.min(base, byRatio);
    return next > current ? next : null;
  }
  return null;
}

function measureHost(terminal: Terminal): { width: number; height: number } | null {
  const el = terminal.element?.parentElement;
  if (!el) return null;
  return { width: el.clientWidth, height: el.clientHeight };
}
