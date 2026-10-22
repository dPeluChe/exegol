import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loseContext = vi.fn();

const addonInstances: Array<{
  dispose: ReturnType<typeof vi.fn>;
  onContextLoss: ReturnType<typeof vi.fn>;
  trigger: () => void;
}> = [];

vi.mock("@xterm/addon-webgl", () => {
  class WebglAddon {
    dispose = vi.fn();
    onContextLoss = vi.fn();
    _renderer = { _gl: { getExtension: () => ({ loseContext }) } };
    constructor() {
      const handle = {
        dispose: this.dispose,
        onContextLoss: this.onContextLoss,
        trigger: () => {
          const callback = this.onContextLoss.mock.calls[0]?.[0];
          if (callback) callback();
        },
      };
      addonInstances.push(handle);
    }
  }
  return { WebglAddon };
});

import { createWebglController, webglCounts } from "./terminal-webgl";
import { createWebglBudget } from "./webgl-budget";

function makeFakeTerminal() {
  const renders: Array<() => void> = [];
  const element = { style: { opacity: "" } };
  const terminal = {
    loadAddon: vi.fn(),
    element,
    onRender: vi.fn((cb: () => void) => {
      renders.push(cb);
      return { dispose: vi.fn() };
    }),
  } as unknown as Terminal;
  return Object.assign(terminal, { renders, fakeElement: element });
}

/** Created parked, as use-xterm does at mount; shown at once */
function shownController(...args: Parameters<typeof createWebglController>) {
  const controller = createWebglController(...args);
  controller.unpark();
  return controller;
}

describe("createWebglController — max retries", () => {
  beforeEach(() => {
    addonInstances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries with backoff (250ms, 1s, 3s), then stays on the DOM renderer", () => {
    const controller = shownController(makeFakeTerminal());

    addonInstances[0]?.trigger();
    vi.advanceTimersByTime(200);
    expect(addonInstances).toHaveLength(1);
    vi.advanceTimersByTime(260);
    expect(addonInstances).toHaveLength(2);

    addonInstances[1]?.trigger();
    vi.advanceTimersByTime(900);
    expect(addonInstances).toHaveLength(2);
    vi.advanceTimersByTime(310);
    expect(addonInstances).toHaveLength(3);

    addonInstances[2]?.trigger();
    vi.advanceTimersByTime(3_210);
    expect(addonInstances).toHaveLength(4);

    addonInstances[3]?.trigger();
    vi.advanceTimersByTime(5_000);
    controller.park();
    controller.unpark();
    expect(addonInstances).toHaveLength(4);
  });

  it("calls onLost on each loss, and a minute without losses restores the budget", () => {
    const onLost = vi.fn();
    shownController(makeFakeTerminal(), { onLost });
    for (let i = 0; i < 3; i++) {
      addonInstances[i]?.trigger();
      vi.advanceTimersByTime(3_300);
    }
    expect(onLost).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(61_000);
    addonInstances[3]?.trigger();
    vi.advanceTimersByTime(460);
    expect(addonInstances).toHaveLength(5);
  });

  it("ignores a loss reported by an addon it already dropped", () => {
    const onLost = vi.fn();
    const controller = shownController(makeFakeTerminal(), { onLost });
    controller.rebuild();
    addonInstances[0]?.trigger();
    expect(onLost).not.toHaveBeenCalled();
  });

  it("dispose() detaches the current addon and stops retries", () => {
    const controller = shownController(makeFakeTerminal());
    addonInstances[0]?.trigger();
    controller.dispose();
    vi.advanceTimersByTime(500);
    expect(addonInstances).toHaveLength(1);
  });
});

describe("createWebglController — rebuild after a GPU crash", () => {
  beforeEach(() => {
    addonInstances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("swaps in a fresh addon and gives WebGL back to a terminal that fell back", () => {
    const controller = shownController(makeFakeTerminal());
    for (let i = 0; i < 4; i++) {
      addonInstances[i]?.trigger();
      vi.advanceTimersByTime(5_000);
    }
    const before = addonInstances.length;

    controller.rebuild();
    expect(addonInstances[before - 1]?.dispose).toHaveBeenCalled();
    expect(addonInstances).toHaveLength(before + 1);
  });

  it("cancels a pending retry so it does not attach a second addon", () => {
    const controller = shownController(makeFakeTerminal());
    addonInstances[0]?.trigger();
    controller.rebuild();
    vi.advanceTimersByTime(5_000);
    expect(addonInstances).toHaveLength(2);
  });

  it("does nothing once disposed", () => {
    const controller = shownController(makeFakeTerminal());
    controller.dispose();
    controller.rebuild();
    expect(addonInstances).toHaveLength(1);
  });
});

describe("createWebglController — parked while hidden", () => {
  beforeEach(() => {
    addonInstances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loses the GL context of an addon it disposes (xterm 0.19 keeps it alive)", () => {
    loseContext.mockClear();
    const controller = shownController(makeFakeTerminal(), {}, createWebglBudget(2));
    controller.dispose();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("starts concealed and pending, shows one frame after WebGL's first render", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
    const terminal = makeFakeTerminal();
    const onRendererChanged = vi.fn();
    const controller = createWebglController(terminal, { onRendererChanged }, createWebglBudget(2));
    expect(terminal.fakeElement.style.opacity).toBe("0");
    expect(controller.pending()).toBe(true);
    controller.unpark();
    expect(controller.pending()).toBe(false);
    expect(onRendererChanged).toHaveBeenCalledTimes(1);
    terminal.renders[0]?.();
    expect(terminal.fakeElement.style.opacity).toBe("0");
    vi.advanceTimersByTime(20);
    expect(terminal.fakeElement.style.opacity).toBe("");
    vi.unstubAllGlobals();
  });

  it("with no slot shows the DOM renderer after the reveal cap", () => {
    const budget = createWebglBudget(1);
    budget.acquire();
    const terminal = makeFakeTerminal();
    const controller = createWebglController(terminal, {}, budget);
    controller.unpark();
    expect(controller.pending()).toBe(false);
    vi.advanceTimersByTime(150);
    expect(terminal.fakeElement.style.opacity).toBe("");
  });

  it("keeps its context while hidden and reuses it when shown", () => {
    const before = webglCounts();
    const controller = shownController(makeFakeTerminal(), {}, createWebglBudget(2));
    controller.park();
    controller.unpark();
    controller.unpark();
    expect(addonInstances).toHaveLength(1);
    expect(addonInstances[0]?.dispose).not.toHaveBeenCalled();
    expect(webglCounts().reused - before.reused).toBe(1);
  });

  it("gives its slot to a shown terminal, then takes a new context when shown again", () => {
    const budget = createWebglBudget(1);
    const hiddenTerminal = makeFakeTerminal();
    const hidden = shownController(hiddenTerminal, {}, budget);
    hidden.park();
    const shown = shownController(makeFakeTerminal(), {}, budget);
    expect(addonInstances).toHaveLength(2);
    expect(addonInstances[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(hiddenTerminal.fakeElement.style.opacity).toBe("0");
    expect(hidden.pending()).toBe(true);
    shown.park();
    hidden.unpark();
    expect(addonInstances).toHaveLength(3);
    expect(budget.live()).toBe(1);
  });

  it("a GPU rebuild while parked waits for the terminal to be shown", () => {
    const budget = createWebglBudget(2);
    const controller = shownController(makeFakeTerminal(), {}, budget);
    controller.park();
    controller.rebuild();
    expect(addonInstances).toHaveLength(1);
    expect(budget.live()).toBe(0);
    controller.unpark();
    expect(addonInstances).toHaveLength(2);
  });
});

describe("the addon internals disposeAddon reaches", () => {
  it("still name the renderer and its GL context (an upgrade that renames them breaks the #6068 workaround)", () => {
    const bundle = readFileSync(
      createRequire(import.meta.url).resolve("@xterm/addon-webgl"),
      "utf8",
    );
    expect(bundle).toContain("this._renderer=");
    expect(bundle).toContain("this._gl=this._canvas.getContext");
  });
});
