import { beforeEach, describe, expect, it } from "vitest";
import { shellClosesOn } from "../stores/agents";
import { useWatchStore } from "../stores/watch";
import { screenRank } from "./auto-resume";
import { pinsToResolve, planWatchFollow, type WatchResolution } from "./watch-follow";

const info = (id: string, status = "crashed") => ({
  id,
  alias: "nyx",
  cliType: "claude-code",
  projectId: "p1",
  projectName: "Argos",
  status,
  statusChangedAt: 1,
  taskDescription: "",
  branchName: null,
});

describe("Watching pins follow their session", () => {
  beforeEach(() => {
    useWatchStore.setState({ watched: [], open: [], cardFont: {}, gone: {} });
  });

  it("only pins whose session is not live here are resolved", () => {
    const agents = { a: { status: "running" }, b: { status: "crashed" } };
    expect(pinsToResolve(["a", "b", "c"], agents)).toEqual(["b", "c"]);
  });

  it("a chain A -> B -> C moves the pin to C; a dead end shows what the session was", () => {
    const results: WatchResolution[] = [
      { id: "A", latest: "C", info: info("C", "running") },
      { id: "X", latest: "X", info: info("X") },
      { id: "Y", latest: "Y", info: null },
    ];
    const plan = planWatchFollow(results, (id) => id === "C");
    expect(plan.replace).toEqual([["A", "C"]]);
    expect(Object.keys(plan.gone)).toEqual(["X"]);
  });

  it("the pin keeps its spot, open state and card font on the new id", () => {
    useWatchStore.setState({ watched: ["x", "A", "y"], open: ["A"], cardFont: { A: 15 } });
    useWatchStore.getState().replaceAgent("A", "B");
    useWatchStore.getState().replaceAgent("B", "C");
    const s = useWatchStore.getState();
    expect(s.watched).toEqual(["x", "C", "y"]);
    expect(s.open).toEqual(["C"]);
    expect(s.cardFont).toEqual({ C: 15 });
  });

  it("two pins that turn out to be one session leave one card, in the first spot", () => {
    useWatchStore.setState({ watched: ["A", "z", "B"], open: [], cardFont: {} });
    useWatchStore.getState().replaceAgent("B", "A");
    expect(useWatchStore.getState().watched).toEqual(["A", "z"]);
  });
});

describe("pinned sessions in the auto-resume order", () => {
  it("rank before everything on screen", () => {
    expect(screenRank("pinned", "p9", {}, "p1", new Set(["pinned"]))).toBe(-1);
    expect(screenRank("other", "p9", {}, "p1", new Set(["pinned"]))).toBe(3);
  });
});

describe("shell panes", () => {
  it("a crashed shell keeps its pane; an ended one closes it", () => {
    expect(shellClosesOn("crashed")).toBe(false);
    expect(shellClosesOn("completed")).toBe(true);
    expect(shellClosesOn("stopped")).toBe(true);
    expect(shellClosesOn("failed")).toBe(true);
  });
});
