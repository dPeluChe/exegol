import { describe, expect, it } from "vitest";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { orderAutoResume, screenRank, sessionUp, staggered, waitUntilUp } from "./auto-resume";

const leaf = (paneId: string) => ({ type: "pane", paneId }) as never;
const pane = (agentId: string) => ({ id: agentId, type: "terminal", agentId }) as never;

const workspaces: Record<string, ProjectWorkspace> = {
  p1: {
    activeTabId: "t1",
    tabs: [
      { id: "t1", layout: leaf("a"), name: "1" } as never,
      { id: "t2", layout: leaf("b"), name: "2" } as never,
    ],
    panes: { a: pane("onScreen"), b: pane("otherTab") },
  },
  p2: {
    activeTabId: "t3",
    tabs: [{ id: "t3", layout: leaf("c"), name: "3" } as never],
    panes: { c: pane("otherProject") },
  },
};

describe("auto-resume order", () => {
  it("ranks the active tab, then other projects' active tabs, then other panes, then none", () => {
    expect(screenRank("onScreen", "p1", workspaces, "p1")).toBe(0);
    expect(screenRank("otherProject", "p2", workspaces, "p1")).toBe(1);
    expect(screenRank("otherTab", "p1", workspaces, "p1")).toBe(2);
    expect(screenRank("ghost", "p1", workspaces, "p1")).toBe(3);
    expect(screenRank("x", "nope", workspaces, "p1")).toBe(3);
  });

  it("on screen first, then the most recently active", () => {
    const items = [
      { id: "old-hidden", lastActiveAt: 1, rank: 2 },
      { id: "new-hidden", lastActiveAt: 9, rank: 2 },
      { id: "old-visible", lastActiveAt: 2, rank: 0 },
      { id: "other-project", lastActiveAt: 5, rank: 1 },
    ];
    expect(orderAutoResume(items, (i) => i.rank).map((i) => i.id)).toEqual([
      "old-visible",
      "other-project",
      "new-hidden",
      "old-hidden",
    ]);
  });
});

describe("staggered", () => {
  it("never runs more than the limit at once, in order", async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    await staggered([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (n === 2) throw new Error("one failure does not stop the rest");
    });
    expect(peak).toBe(3);
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("sessionUp", () => {
  it("needs the prompt and, when a bridge was wired, its connection", () => {
    expect(sessionUp("running", "connected")).toBe(false);
    expect(sessionUp("waiting_input", "not_connected")).toBe(false);
    expect(sessionUp("waiting_input", "connected")).toBe(true);
    expect(sessionUp("idle", "not_wired")).toBe(true);
    expect(sessionUp("idle", undefined)).toBe(true);
    expect(sessionUp(undefined, undefined)).toBe(true);
  });
});

describe("waitUntilUp", () => {
  const source = () => {
    const listeners = new Set<() => void>();
    return {
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      emit: () => {
        for (const fn of listeners) fn();
      },
      count: () => listeners.size,
    };
  };

  it("waits for the quiet period, and starts it again after a drop", async () => {
    const s = source();
    let up = true;
    const started = Date.now();
    const waiting = waitUntilUp(() => up, s.subscribe, 40, 1000);
    setTimeout(() => {
      up = false;
      s.emit();
    }, 20);
    setTimeout(() => {
      up = true;
      s.emit();
    }, 60);
    await waiting;
    expect(Date.now() - started).toBeGreaterThanOrEqual(95);
    expect(s.count()).toBe(0);
  });

  it("gives up at the cap when the session never comes up", async () => {
    const s = source();
    const started = Date.now();
    await waitUntilUp(() => false, s.subscribe, 40, 60);
    expect(Date.now() - started).toBeLessThan(500);
    expect(s.count()).toBe(0);
  });
});
