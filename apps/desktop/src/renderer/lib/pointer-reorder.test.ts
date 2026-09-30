import { describe, expect, it } from "vitest";
import { endGesture, moveGesture, startGesture } from "./pointer-reorder";

describe("pointer reorder gesture", () => {
  it("a press that barely moves is a click: no drop, click not swallowed", () => {
    const g = moveGesture(startGesture("a", 10, 10), 12, 11, "b");
    expect(endGesture(g)).toEqual({ drop: null, wasDrag: false });
  });

  it("dragging onto another item drops there and swallows the click", () => {
    let g = startGesture("a", 10, 10);
    g = moveGesture(g, 10, 40, "a");
    g = moveGesture(g, 10, 90, "c");
    expect(endGesture(g)).toEqual({ drop: { drag: "a", target: "c" }, wasDrag: true });
  });

  it("released over itself or outside any item: no drop, still a drag", () => {
    const self = moveGesture(startGesture("a", 0, 0), 0, 30, "a");
    expect(endGesture(self)).toEqual({ drop: null, wasDrag: true });
    const outside = moveGesture(startGesture("a", 0, 0), 0, 30, null);
    expect(endGesture(outside)).toEqual({ drop: null, wasDrag: true });
  });
});
