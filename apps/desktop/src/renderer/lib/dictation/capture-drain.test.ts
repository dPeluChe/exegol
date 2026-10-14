import { afterEach, describe, expect, it, vi } from "vitest";
import { captureReceiver } from "./capture-drain";

const chunk = (n: number) => new Float32Array(n).fill(0.1);

afterEach(() => {
  vi.useRealTimers();
});

describe("captureReceiver", () => {
  it("passes chunks through and skips empty ones", () => {
    const got: number[] = [];
    const r = captureReceiver((s) => got.push(s.length));
    r.receive(chunk(1600));
    r.receive(new Float32Array(0));
    expect(got).toEqual([1600]);
  });

  it("drain resolves only after the chunks in flight and the flushed rest arrived", async () => {
    const got: number[] = [];
    const r = captureReceiver((s) => got.push(s.length));
    let resolved = false;
    const drained = r
      .drain(() => {})
      .then(() => {
        resolved = true;
      });
    r.receive(chunk(1600));
    await Promise.resolve();
    expect(resolved).toBe(false);
    r.receive({ flushed: chunk(700) });
    await drained;
    expect(got).toEqual([1600, 700]);
  });

  it("an empty flush still ends the drain", async () => {
    const onChunk = vi.fn();
    const r = captureReceiver(onChunk);
    const drained = r.drain(() => r.receive({ flushed: new Float32Array(0) }));
    await drained;
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("a stalled worklet does not hold the stop past the timeout", async () => {
    vi.useFakeTimers();
    const r = captureReceiver(() => {}, 500);
    let resolved = false;
    void r
      .drain(() => {})
      .then(() => {
        resolved = true;
      });
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("closing the capture ends a pending drain", async () => {
    const r = captureReceiver(() => {});
    const drained = r.drain(() => {});
    r.settle();
    await expect(drained).resolves.toBeUndefined();
  });
});
