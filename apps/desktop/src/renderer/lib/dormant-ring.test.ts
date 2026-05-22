import { describe, expect, it } from "vitest";
import { DORMANT_OVERFLOW_NOTICE, DormantRing } from "./dormant-ring";

describe("DormantRing", () => {
  it("drains the exact concatenation when under the cap", () => {
    const ring = new DormantRing();
    ring.write("foo");
    ring.write("bar");
    ring.write("baz");
    expect(ring.drain()).toBe("foobarbaz");
    expect(ring.byteLength()).toBe(0);
  });

  it("returns empty string on drain when nothing was written", () => {
    expect(new DormantRing().drain()).toBe("");
  });

  it("clear() empties the ring without producing an overflow notice", () => {
    const ring = new DormantRing(64, 4);
    ring.write("abc");
    ring.write("def");
    ring.clear();
    expect(ring.byteLength()).toBe(0);
    expect(ring.drain()).toBe("");
    expect(ring.didOverflow()).toBe(false);
  });

  it("prepends ESC c + overflow notice when byte cap is exceeded", () => {
    const ring = new DormantRing(8, 256);
    ring.write("aaaa");
    ring.write("bbbb");
    ring.write("cccc");
    const drained = ring.drain();
    expect(drained.startsWith(DORMANT_OVERFLOW_NOTICE)).toBe(true);
    expect(drained.endsWith("cccc")).toBe(true);
    expect(drained).not.toContain("aaaa");
  });

  it("retains only the most recent tail when a single oversized write arrives", () => {
    const ring = new DormantRing(8);
    const huge = "x".repeat(100);
    ring.write(huge);
    const drained = ring.drain();
    expect(drained.startsWith(DORMANT_OVERFLOW_NOTICE)).toBe(true);
    expect(drained.slice(DORMANT_OVERFLOW_NOTICE.length)).toBe("x".repeat(8));
  });

  it("caps chunk count: 257 small chunks → 256 retained + overflow notice", () => {
    const ring = new DormantRing(1024 * 1024, 256);
    for (let i = 0; i < 257; i++) ring.write(`<c${i}>`);
    const drained = ring.drain();
    expect(drained.startsWith(DORMANT_OVERFLOW_NOTICE)).toBe(true);
    expect(drained.includes("<c0>")).toBe(false);
    expect(drained.endsWith("<c256>")).toBe(true);
  });

  it("after drain, isEmpty() and overflowed flag both reset", () => {
    const ring = new DormantRing(8);
    ring.write("aaaa");
    ring.write("bbbb");
    ring.write("cccc");
    ring.drain();
    expect(ring.isEmpty()).toBe(true);
    expect(ring.didOverflow()).toBe(false);
  });
});
