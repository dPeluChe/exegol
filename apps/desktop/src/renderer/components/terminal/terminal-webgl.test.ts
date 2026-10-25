import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loseContext = vi.fn();

const addonInstances: Array<{
  addon: object;
  /** Addons alive (since load) when this one was built: they share xterm's glyph atlas with it */
  aliveAtBuild: number;
  dispose: ReturnType<typeof vi.fn>;
  onContextLoss: ReturnType<typeof vi.fn>;
  trigger: () => void;
  /** The shared atlas made a page: every addon on it forwards the same canvas */
  addPage: (canvas: object) => void;
}> = [];

vi.mock("@xterm/addon-webgl", () => {
  class WebglAddon {
    dispose = vi.fn();
    onContextLoss = vi.fn();
    onAddTextureAtlasCanvas = vi.fn();
    _renderer = { _gl: { getExtension: () => ({ loseContext }) } };
    constructor() {
      const handle = {
        addon: this,
        aliveAtBuild: liveWebglAddons(),
        dispose: this.dispose,
        onContextLoss: this.onContextLoss,
        trigger: () => {
          const callback = this.onContextLoss.mock.calls[0]?.[0];
          if (callback) callback();
        },
        addPage: (canvas: object) => {
          for (const [cb] of this.onAddTextureAtlasCanvas.mock.calls) cb(canvas);
        },
      };
      addonInstances.push(handle);
    }
  }
  return { WebglAddon };
});

import { repaintTerminals } from "../../lib/gpu-repaint";
import { CHURN_COOLDOWNS_MS, CHURN_PAGES, resetPageNotes } from "./atlas-churn";
import { createWebglController, listenGpuRepaint } from "./terminal-webgl";
import { createWebglBudget } from "./webgl-budget";
import { liveWebglAddons, webglCounts } from "./webgl-counts";

beforeEach(() => {
  addonInstances.length = 0;
  resetPageNotes();
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function makeFakeTerminal() {
  const renders: Array<() => void> = [];
  const element = { style: { opacity: "" } };
  const terminal = {
    loadAddon: vi.fn(),
    element,
    // Like xterm's emitter: a disposed listener never fires again
    onRender: vi.fn((cb: () => void) => {
      renders.push(cb);
      return {
        dispose: () => {
          const at = renders.indexOf(cb);
          if (at >= 0) renders.splice(at, 1);
        },
      };
    }),
  } as unknown as Terminal;
  return Object.assign(terminal, { renders, fakeElement: element });
}

function renderOnce(t: { renders: Array<() => void> }) {
  for (const cb of t.renders.slice()) cb();
}

/** Created parked, as use-xterm does at mount; shown at once */
function shownController(...args: Parameters<typeof createWebglController>) {
  const controller = createWebglController(...args);
  controller.unpark();
  return controller;
}

describe("createWebglController — max retries", () => {
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

  it("drop lets go of the context and its slot, and the rebuild after it attaches once", () => {
    const budget = createWebglBudget(2);
    const controller = shownController(makeFakeTerminal(), {}, budget);
    controller.drop();
    expect(addonInstances[0]?.dispose).toHaveBeenCalled();
    expect(budget.live()).toBe(0);
    expect(addonInstances).toHaveLength(1);
    controller.rebuild();
    expect(addonInstances).toHaveLength(2);
    expect(budget.live()).toBe(1);
  });

  it("a GPU repaint through the views' real listeners builds no addon beside a pre-crash one", () => {
    const budget = createWebglBudget(12);
    const base = liveWebglAddons();
    const target = new EventTarget();
    const make = () => {
      const controller = shownController(makeFakeTerminal(), {}, budget);
      listenGpuRepaint(
        target,
        () => controller,
        () => true,
      );
      return controller;
    };
    const views = [make(), make(), make()];
    const hidden = make();
    hidden.park();
    const before = addonInstances.length;

    const report = repaintTerminals(target, () => liveWebglAddons() - base);
    expect(report).toEqual({ views: 4, before: 4, afterDrop: 0, rebuilt: 3 });
    const rebuilt = addonInstances.slice(before);
    expect(rebuilt).toHaveLength(3);
    // The first one built finds no other owner, so xterm makes it a fresh atlas
    expect(rebuilt[0]?.aliveAtBuild).toBe(base);
    hidden.unpark();
    expect(addonInstances).toHaveLength(before + 4);
    expect(views).toHaveLength(3);
  });

  it("a view still holding its addon after the drop shows in the report", () => {
    const base = liveWebglAddons();
    const target = new EventTarget();
    const held = shownController(makeFakeTerminal(), {}, createWebglBudget(12));
    // Listens to the repaint only, as a view that missed the drop would
    target.addEventListener("exegol:gpu-repaint", () => held.rebuild());
    expect(repaintTerminals(target, () => liveWebglAddons() - base).afterDrop).toBe(1);
  });

  it("rebuilding view by view (the old path) builds beside pre-crash addons", () => {
    const budget = createWebglBudget(12);
    const base = liveWebglAddons();
    const views = [0, 1, 2].map(() => shownController(makeFakeTerminal(), {}, budget));
    const before = addonInstances.length;
    for (const c of views) c.rebuild();
    expect((addonInstances[before]?.aliveAtBuild ?? 0) - base).toBe(2);
  });

  it("does nothing once disposed", () => {
    const controller = shownController(makeFakeTerminal());
    controller.dispose();
    controller.drop();
    controller.rebuild();
    expect(addonInstances).toHaveLength(1);
  });
});

describe("createWebglController — parked while hidden", () => {
  it("loses the GL context of an addon it disposes (xterm 0.19 keeps it alive)", () => {
    loseContext.mockClear();
    const controller = shownController(makeFakeTerminal(), {}, createWebglBudget(2));
    controller.dispose();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("starts concealed and pending, shows one frame after WebGL's first render", () => {
    const terminal = makeFakeTerminal();
    const onRendererChanged = vi.fn();
    const controller = createWebglController(terminal, { onRendererChanged }, createWebglBudget(2));
    expect(terminal.fakeElement.style.opacity).toBe("0");
    expect(controller.pending()).toBe(true);
    controller.unpark();
    expect(controller.pending()).toBe(false);
    expect(onRendererChanged).toHaveBeenCalledTimes(1);
    renderOnce(terminal);
    expect(terminal.fakeElement.style.opacity).toBe("0");
    vi.advanceTimersByTime(20);
    expect(terminal.fakeElement.style.opacity).toBe("");
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

  it("a refit that throws on attach keeps the slot counted", () => {
    const budget = createWebglBudget(2);
    const controller = createWebglController(
      makeFakeTerminal(),
      {
        onRendererChanged: () => {
          throw new Error("fit failed");
        },
      },
      budget,
    );
    expect(() => controller.unpark()).toThrow("fit failed");
    expect(budget.live()).toBe(1);
    controller.dispose();
    expect(budget.live()).toBe(0);
  });

  it("a context hidden before it drew stays concealed until it draws", () => {
    const terminal = makeFakeTerminal();
    const controller = createWebglController(terminal, {}, createWebglBudget(2));
    controller.unpark();
    controller.park();
    controller.unpark();
    expect(terminal.fakeElement.style.opacity).toBe("0");
    terminal.renders.at(-1)?.();
    vi.advanceTimersByTime(20);
    expect(terminal.fakeElement.style.opacity).toBe("");
  });

  it("in DOM-only mode a concealed terminal shows at once", () => {
    const budget = createWebglBudget(2);
    budget.setDomOnly();
    const terminal = makeFakeTerminal();
    createWebglController(terminal, {}, budget).unpark();
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

describe("createWebglController — glyph atlas churn", () => {
  type View = ReturnType<typeof makeFakeTerminal>;
  /** One frame of `t` that made `pages` new atlas pages, forwarded by every addon on the atlas */
  function churnFrame(t: View, pages: number) {
    for (let i = 0; i < pages; i++) {
      const canvas = {};
      for (const a of addonInstances) a.addPage(canvas);
    }
    renderOnce(t);
  }

  it("a view making pages fast goes to the DOM renderer, then back to WebGL after the cooldown", () => {
    const terminal = makeFakeTerminal();
    const budget = createWebglBudget(2);
    const onChurn = vi.fn();
    const onRendererChanged = vi.fn();
    const controller = shownController(terminal, { onChurn, onRendererChanged }, budget);
    onRendererChanged.mockClear();
    for (let f = 0; f < 4; f++) {
      churnFrame(terminal, CHURN_PAGES / 4);
      vi.advanceTimersByTime(100);
    }
    expect(onChurn).toHaveBeenCalledTimes(1);
    expect(onChurn.mock.calls[0]?.[0]).toEqual({
      pages: CHURN_PAGES,
      overMs: 300,
      domForMs: CHURN_COOLDOWNS_MS[0],
    });
    expect(addonInstances[0]?.dispose).toHaveBeenCalled();
    expect(budget.live()).toBe(0);
    expect(onRendererChanged).toHaveBeenCalledTimes(1);
    expect(controller.pending()).toBe(false);
    // A GPU crash repaint meanwhile keeps it on the DOM renderer
    controller.rebuild();
    expect(addonInstances).toHaveLength(1);
    vi.advanceTimersByTime(CHURN_COOLDOWNS_MS[0]);
    expect(addonInstances).toHaveLength(2);
    expect(budget.live()).toBe(1);
  });

  it("normal output (a page now and then) never trips", () => {
    const terminal = makeFakeTerminal();
    const onChurn = vi.fn();
    shownController(terminal, { onChurn }, createWebglBudget(2));
    for (let f = 0; f < 200; f++) {
      churnFrame(terminal, f % 20 === 0 ? 1 : 0);
      vi.advanceTimersByTime(100);
    }
    expect(onChurn).not.toHaveBeenCalled();
    expect(addonInstances[0]?.dispose).not.toHaveBeenCalled();
  });

  it("on a shared atlas only the view that drew the pages leaves WebGL", () => {
    const culprit = makeFakeTerminal();
    const neighbour = makeFakeTerminal();
    const budget = createWebglBudget(4);
    const onChurn = vi.fn();
    const onNeighbourChurn = vi.fn();
    shownController(culprit, { onChurn }, budget);
    shownController(neighbour, { onChurn: onNeighbourChurn }, budget);
    for (let f = 0; f < 4; f++) {
      churnFrame(culprit, CHURN_PAGES / 4);
      renderOnce(neighbour);
    }
    expect(onChurn).toHaveBeenCalledTimes(1);
    expect(onNeighbourChurn).not.toHaveBeenCalled();
    expect(addonInstances[0]?.dispose).toHaveBeenCalled();
    expect(addonInstances[1]?.dispose).not.toHaveBeenCalled();
  });

  it("a repeat within the calm window stays off longer; dispose cancels the return", () => {
    const terminal = makeFakeTerminal();
    const budget = createWebglBudget(2);
    const onChurn = vi.fn();
    const controller = shownController(terminal, { onChurn }, budget);
    churnFrame(terminal, CHURN_PAGES);
    vi.advanceTimersByTime(CHURN_COOLDOWNS_MS[0]);
    churnFrame(terminal, CHURN_PAGES);
    expect(onChurn.mock.calls.map(([t]) => t.domForMs)).toEqual(CHURN_COOLDOWNS_MS.slice(0, 2));
    controller.dispose();
    vi.advanceTimersByTime(CHURN_COOLDOWNS_MS[1]);
    expect(addonInstances).toHaveLength(2);
    expect(budget.live()).toBe(0);
  });
});

describe("the addon internals disposeAddon reaches", () => {
  const bundle = readFileSync(createRequire(import.meta.url).resolve("@xterm/addon-webgl"), "utf8");

  it("still name the renderer and its GL context (an upgrade that renames them breaks the #6068 workaround)", () => {
    expect(bundle).toContain("this._renderer=");
    expect(bundle).toContain("this._gl=this._canvas.getContext");
  });

  it("still share one glyph atlas per config among terminals (why a GPU repaint drops every view first)", () => {
    expect(bundle).toContain("ownedBy.push(");
  });
});

/** Small deterministic PRNG so a failing sequence replays from its seed */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

describe("createWebglController — random sequences keep the invariants", () => {
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", (seed) => {
    const rand = rng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const CAP = 3;
    const budget = createWebglBudget(CAP);
    type View = {
      terminal: ReturnType<typeof makeFakeTerminal>;
      controller: ReturnType<typeof createWebglController>;
      shown: boolean;
      disposed: boolean;
    };
    const views: View[] = [];
    const owner = new Map<object, View>();
    const mount = () => {
      const terminal = makeFakeTerminal();
      const view: View = {
        terminal,
        controller: createWebglController(terminal, {}, budget),
        shown: false,
        disposed: false,
      };
      (terminal.loadAddon as ReturnType<typeof vi.fn>).mockImplementation((a: object) => {
        owner.set(a, view);
      });
      views.push(view);
    };
    for (let i = 0; i < 5; i++) mount();
    const live = () => addonInstances.filter((a) => a.dispose.mock.calls.length === 0);
    const holder = (addon: object) => owner.get(addon);

    const check = (step: string) => {
      const alive = live();
      // Every live addon is one budget slot, held by a view that is not disposed
      expect(budget.live(), step).toBe(alive.length);
      expect(alive.length, step).toBeLessThanOrEqual(CAP);
      for (const a of alive) expect(holder(a.addon)?.disposed, step).toBe(false);
      for (const v of views) {
        if (v.disposed) continue;
        // A context is due on the next show: hidden, so concealed
        if (v.controller.pending()) expect(v.terminal.fakeElement.style.opacity, step).toBe("0");
      }
    };

    for (let i = 0; i < 120; i++) {
      const open = views.filter((v) => !v.disposed);
      const v = pick(open);
      const op = pick([
        "show",
        "show",
        "hide",
        "hide",
        "rebuild",
        "gpuCrash",
        "loss",
        "staleLoss",
        "time",
        "render",
        "dispose",
        "domOnly",
      ]);
      if (op === "show") {
        v.shown = true;
        v.controller.unpark();
      } else if (op === "hide") {
        v.shown = false;
        v.controller.park();
      } else if (op === "rebuild") {
        v.controller.rebuild();
      } else if (op === "gpuCrash") {
        // gpu-repaint: every view drops, then every view rebuilds
        for (const o of open) o.controller.drop();
        expect(live(), `step ${i} gpuCrash`).toHaveLength(0);
        for (const o of open) o.controller.rebuild();
      } else if (op === "loss" || op === "staleLoss") {
        const own = addonInstances.filter((a) => holder(a.addon) === v);
        const target = op === "loss" ? own.find((a) => a.dispose.mock.calls.length === 0) : own[0];
        target?.trigger();
      } else if (op === "time") {
        vi.advanceTimersByTime(pick([16, 150, 300, 3_500]));
      } else if (op === "domOnly") {
        // Rare, as in the app (three GPU crashes)
        if (rand() < 0.1) budget.setDomOnly();
      } else if (op === "render") {
        renderOnce(v.terminal);
      } else {
        v.controller.dispose();
        v.disposed = true;
        mount();
      }
      check(`seed ${seed} step ${i} ${op}`);
    }

    // Settled: no shown terminal stays concealed once renders ran and the caps passed
    for (const v of views) renderOnce(v.terminal);
    vi.advanceTimersByTime(10_000);
    for (const v of views) renderOnce(v.terminal);
    vi.advanceTimersByTime(200);
    check(`seed ${seed} settled`);
    for (const v of views) {
      if (v.disposed || !v.shown) continue;
      expect(v.terminal.fakeElement.style.opacity, `seed ${seed} shown view concealed`).toBe("");
    }
  });
});
