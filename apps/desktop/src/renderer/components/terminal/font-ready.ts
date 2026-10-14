import type { Terminal } from "@xterm/xterm";

type FontTerminal = Pick<Terminal, "options">;

/**
 * A bundled font (`font-display: block`, fetched on first use) can finish loading after the first
 * fit: xterm measured the fallback's cells and remeasures only on a font option change, so the
 * grid kept the fallback's rows. Once the font loads, remeasure and run `refit`.
 * Returns a cancel for unmount.
 */
export function refitWhenFontLoads(terminal: FontTerminal, refit: () => void): () => void {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return () => {};
  const font = `${terminal.options.fontSize ?? 14}px ${terminal.options.fontFamily ?? "monospace"}`;
  let loading: Promise<unknown>;
  try {
    if (fonts.check(font)) return () => {};
    loading = fonts.load(font);
  } catch {
    // Not a valid CSS font shorthand: nothing to wait for
    return () => {};
  }
  let cancelled = false;
  loading.then(
    () => {
      if (cancelled) return;
      remeasureCells(terminal);
      refit();
    },
    () => {},
  );
  return () => {
    cancelled = true;
  };
}

/** xterm's only public path to a new char measure: a font option change (equal values are no-ops) */
function remeasureCells(terminal: FontTerminal): void {
  const size = terminal.options.fontSize ?? 14;
  terminal.options.fontSize = size + 1;
  terminal.options.fontSize = size;
}
