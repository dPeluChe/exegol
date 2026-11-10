import { describe, expect, it } from "vitest";
import { restartOrder, updateGaveUp, useCliRestartStore } from "./cli-restarts";

describe("updateGaveUp", () => {
  it("waits for the update, 10 min at most or 30 s after its shell ended", () => {
    expect(updateGaveUp(undefined, 1e9)).toBe(false);
    expect(updateGaveUp({ startedAt: 0, shellId: "s" }, 9 * 60_000)).toBe(false);
    expect(updateGaveUp({ startedAt: 0, shellId: "s" }, 11 * 60_000)).toBe(true);
    const ended = { startedAt: 0, shellId: "s", shellEndedAt: 60_000 };
    expect(updateGaveUp(ended, 80_000)).toBe(false);
    expect(updateGaveUp(ended, 95_000)).toBe(true);
  });
});

describe("restartOrder", () => {
  it("puts the focused session first, then its project's, the rest as asked", () => {
    const project: Record<string, string> = { a: "p1", b: "p2", c: "p2", d: "p1" };
    const of = (id: string) => project[id];
    expect(restartOrder(["a", "b", "c", "d"], of, "c", "p2")).toEqual(["c", "b", "a", "d"]);
    expect(restartOrder(["a", "b"], of, null, null)).toEqual(["a", "b"]);
  });
});

describe("useCliRestartStore", () => {
  it("cancel forgets the restart and the update it waited on", () => {
    const s = useCliRestartStore.getState();
    s.request("a", "update");
    s.watchUpdate(["a"], "shell");
    s.shellEnded("a", 5);
    expect(useCliRestartStore.getState().updates.a).toMatchObject({
      shellId: "shell",
      shellEndedAt: 5,
    });
    s.cancel("a");
    expect(useCliRestartStore.getState().pending.a).toBeUndefined();
    expect(useCliRestartStore.getState().updates.a).toBeUndefined();
  });
});
