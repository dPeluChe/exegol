import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitMirror } from "./terminal-setup";

/** A terminal whose painted width rounds the cell to device pixels, like xterm does. */
function fakeTerminal(cols: number, hostWidth: number, fontSize: number) {
  const options = { fontSize };
  let fontChanges = 0;
  const screen = {
    getBoundingClientRect: () => ({ width: (cols * Math.round(options.fontSize * 0.6 * 2)) / 2 }),
  };
  const terminal = {
    cols,
    get options() {
      return options;
    },
    element: {
      parentElement: { clientWidth: hostWidth, clientHeight: 400 },
      querySelector: () => screen,
    },
  };
  const tracked = new Proxy(options, {
    set(target, key, value) {
      if (key === "fontSize" && value !== target.fontSize) fontChanges++;
      (target as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
  Object.defineProperty(terminal, "options", { get: () => tracked });
  return { terminal: terminal as unknown as Terminal, fontChanges: () => fontChanges, options };
}

describe("fitMirror", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converges and stops changing the font, at every width (no atlas-rebuild loop)", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
    for (const cols of [80, 120, 160, 220])
      for (let width = 200; width <= 2000; width += 7) {
        const { terminal, fontChanges, options } = fakeTerminal(cols, width, 14);
        fitMirror(terminal, 14);
        while (frames.length) frames.shift()?.();
        const settledAt = fontChanges();
        // Later triggers (resize observer, window resize) must not move it again
        for (let i = 0; i < 5; i++) {
          fitMirror(terminal, 14);
          while (frames.length) frames.shift()?.();
        }
        expect(fontChanges()).toBe(settledAt);
        expect(settledAt).toBeLessThanOrEqual(4);
        const drawn = (cols * Math.round(options.fontSize * 0.6 * 2)) / 2;
        // Fits the card unless already at the smallest readable size
        if (options.fontSize > 6) expect(drawn).toBeLessThanOrEqual(width + 1);
      }
  });
});
