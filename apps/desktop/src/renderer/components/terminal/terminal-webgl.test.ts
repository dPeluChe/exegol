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

  it("retries with backoff (250ms, 1s, 3s), then stays on the DOM renderer", () => {
    const controller = createWebglController(makeFakeTerminal());
    controller.attach();

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
    expect(addonInstances).toHaveLength(4);
    expect(controller.hasFallenBack()).toBe(true);
  });

  it("calls onLost on each loss, and a minute without losses restores the budget", () => {
    const onLost = vi.fn();
    const controller = createWebglController(makeFakeTerminal(), onLost);
    controller.attach();
    for (let i = 0; i < 3; i++) {
      addonInstances[i]?.trigger();
      vi.advanceTimersByTime(3_300);
    }
    expect(onLost).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(61_000);
    addonInstances[3]?.trigger();
    vi.advanceTimersByTime(460);
    expect(addonInstances).toHaveLength(5);
    expect(controller.hasFallenBack()).toBe(false);
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
