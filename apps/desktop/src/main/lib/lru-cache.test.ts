import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncLruCache } from "./lru-cache";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("AsyncLruCache", () => {
  it("shares one in-flight computation between callers", async () => {
    const cache = new AsyncLruCache<string, number>(4, 2_000);
    const d = deferred<number>();
    const factory = vi.fn(() => d.promise);
    const a = cache.getOrCompute("k", factory);
    const b = cache.getOrCompute("k", factory);
    d.resolve(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("serves the value within the TTL and computes again after it", async () => {
    vi.useFakeTimers();
    const cache = new AsyncLruCache<string, number>(4, 2_000);
    let n = 0;
    const factory = vi.fn(async () => ++n);
    expect(await cache.getOrCompute("k", factory)).toBe(1);
    vi.advanceTimersByTime(1_999);
    expect(await cache.getOrCompute("k", factory)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(await cache.getOrCompute("k", factory)).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure", async () => {
    const cache = new AsyncLruCache<string, number>(4, 2_000);
    await expect(
      cache.getOrCompute("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cache.getOrCompute("k", async () => 3)).toBe(3);
  });

  it("drops a value that was being computed when the key was invalidated", async () => {
    const cache = new AsyncLruCache<string, number>(4, 2_000);
    const old = deferred<number>();
    const first = cache.getOrCompute("k", () => old.promise);
    cache.invalidateWhere(() => true);
    const second = cache.getOrCompute("k", async () => 2);
    old.resolve(1);
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(await cache.getOrCompute("k", async () => 9)).toBe(2);
  });
});
