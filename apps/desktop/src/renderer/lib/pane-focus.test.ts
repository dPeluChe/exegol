import { describe, expect, it, vi } from "vitest";

vi.mock("../stores/workspace", () => ({}));
const { adjacentPane } = await import("./pane-focus");

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
