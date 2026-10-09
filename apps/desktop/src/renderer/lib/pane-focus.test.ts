import { describe, expect, it, vi } from "vitest";

vi.mock("../stores/workspace", () => ({}));
vi.stubGlobal("requestAnimationFrame", () => 0);
const { adjacentPane, claimPaneFocus, dropPaneFocus, focusNewPane } = await import("./pane-focus");

describe("adjacentPane", () => {
  it("moves forward and back, wrapping around", () => {
    expect(adjacentPane(["a", "b", "c"], "a", "next")).toBe("b");
    expect(adjacentPane(["a", "b", "c"], "c", "next")).toBe("a");
    expect(adjacentPane(["a", "b", "c"], "a", "prev")).toBe("c");
  });

  it("starts at the first pane when none (or one from another tab) is focused", () => {
    expect(adjacentPane(["a", "b"], null, "next")).toBe("a");
    expect(adjacentPane(["a", "b"], "other-tab-pane", "prev")).toBe("a");
    expect(adjacentPane([], "a", "next")).toBeNull();
  });
});

describe("focusNewPane / claimPaneFocus", () => {
  it("a new pane's view claims the keyboard once; a dropped or unknown pane never does", () => {
    focusNewPane("p1");
    expect(claimPaneFocus("p1")).toBe(true);
    expect(claimPaneFocus("p1")).toBe(false);
    focusNewPane("p2");
    dropPaneFocus("p2");
    expect(claimPaneFocus("p2")).toBe(false);
    expect(claimPaneFocus("never")).toBe(false);
  });
});
