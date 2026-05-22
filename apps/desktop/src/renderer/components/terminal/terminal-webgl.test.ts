import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addonInstances: Array<{
  dispose: ReturnType<typeof vi.fn>;
  onContextLoss: ReturnType<typeof vi.fn>;
  trigger: () => void;
}> = [];

vi.mock("@xterm/addon-webgl", () => {
  class WebglAddon {
    dispose = vi.fn();
    onContextLoss = vi.fn();
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

import { createWebglController } from "./terminal-webgl";

function makeFakeTerminal(): Terminal {
  return {
    loadAddon: vi.fn(),
    element: null,
  } as unknown as Terminal;
}

describe("createWebglController — max retries", () => {
  beforeEach(() => {
    addonInstances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("attempts up to 3 retries then falls back to canvas renderer", () => {
    const term = makeFakeTerminal();
    const controller = createWebglController(term);
    controller.attach();
    expect(addonInstances).toHaveLength(1);

    // Loss → schedule retry → 250 ms later a new addon is created.
    for (let i = 0; i < 3; i++) {
      addonInstances[i]?.trigger();
      expect(controller.hasFallenBack()).toBe(false);
      vi.advanceTimersByTime(260);
    }
    // After 3 retries we've created 4 addons total (initial + 3).
    expect(addonInstances).toHaveLength(4);

    // 4th loss exhausts the budget → no further addon created → fallback.
    addonInstances[3]?.trigger();
    vi.advanceTimersByTime(260);
    expect(addonInstances).toHaveLength(4);
    expect(controller.hasFallenBack()).toBe(true);
  });

  it("dispose() detaches the current addon and stops retries", () => {
    const term = makeFakeTerminal();
    const controller = createWebglController(term);
    controller.attach();
    addonInstances[0]?.trigger();
    controller.dispose();
    vi.advanceTimersByTime(500);
    expect(addonInstances).toHaveLength(1);
  });
});
