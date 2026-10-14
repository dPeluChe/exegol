import { describe, expect, it, vi } from "vitest";
import type { LiveSnapshot } from "./live-seq";
import { createDormantPipe } from "./terminal-dormant-wiring";

const fakeTerminal = () => {
  const log: string[] = [];
  return { log, write: vi.fn((d: string) => log.push(d)), reset: vi.fn(() => log.push("<reset>")) };
};

describe("createDormantPipe", () => {
  it("replays what arrived while hidden, in order", () => {
    const t = fakeTerminal();
    const pipe = createDormantPipe(t, true);
    pipe.setVisible(false);
    pipe.push("a");
    pipe.push("b");
    pipe.setVisible(true);
    expect(t.log).toEqual(["ab"]);
  });

  it("after an overflow, resets to main's snapshot instead of drawing a partial tail", async () => {
    const t = fakeTerminal();
    let resolve: (s: LiveSnapshot) => void = () => {};
    const pipe = createDormantPipe(t, true, () => new Promise((r) => (resolve = r)));
    pipe.setVisible(false);
    for (let i = 0; i < 300; i++) pipe.push(`frame${i}`); // more chunks than the ring keeps
    pipe.setVisible(true);
    pipe.push("live"); // arrives while the snapshot is on its way
    expect(t.log).toEqual([]);
    resolve({ data: "SCREEN", seq: null, cols: 80, rows: 24 });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.log).toEqual(["<reset>", "SCREEN", "live"]);
  });

  it("drops output that arrived during the fetch and is already in the snapshot", async () => {
    const t = fakeTerminal();
    let resolve: (s: LiveSnapshot) => void = () => {};
    const pipe = createDormantPipe(t, true, () => new Promise((r) => (resolve = r)));
    pipe.setVisible(false);
    for (let i = 0; i < 300; i++) pipe.push(`frame${i}`, i);
    pipe.setVisible(true);
    pipe.push("held", 300);
    pipe.push("new", 301);
    resolve({ data: "SCREEN", seq: 300, cols: 80, rows: 24 });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.log).toEqual(["<reset>", "SCREEN", "new"]);
  });

  it("without a snapshot source it falls back to the ring's tail", () => {
    const t = fakeTerminal();
    const pipe = createDormantPipe(t, true);
    pipe.setVisible(false);
    for (let i = 0; i < 300; i++) pipe.push(`f${i}`);
    pipe.setVisible(true);
    expect(t.log).toHaveLength(1);
    expect(t.log[0]).toContain("f299");
  });
});
