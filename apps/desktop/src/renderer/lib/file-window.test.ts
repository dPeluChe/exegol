import { describe, expect, it } from "vitest";
import {
  clampRect,
  defaultRect,
  displayPath,
  dragRect,
  FILE_WINDOW_MIN,
  underRoot,
} from "./file-window";

const vp = { width: 1200, height: 800 };

describe("clampRect", () => {
  it("keeps a rect that fits as it is", () => {
    const r = { x: 100, y: 100, width: 500, height: 400 };
    expect(clampRect(r, vp)).toEqual(r);
  });

  it("pulls a window dragged past an edge back inside", () => {
    expect(clampRect({ x: 1000, y: -50, width: 500, height: 400 }, vp)).toEqual({
      x: 692,
      y: 8,
      width: 500,
      height: 400,
    });
  });

  it("shrinks a remembered size to a smaller window, never below the minimum", () => {
    expect(clampRect({ x: 0, y: 0, width: 3000, height: 3000 }, vp)).toEqual({
      x: 8,
      y: 8,
      width: 1184,
      height: 784,
    });
    const tiny = clampRect({ x: 10, y: 10, width: 10, height: 10 }, vp);
    expect(tiny.width).toBe(FILE_WINDOW_MIN.width);
    expect(tiny.height).toBe(FILE_WINDOW_MIN.height);
  });
});

describe("defaultRect", () => {
  it("centers the window", () => {
    const r = defaultRect(vp);
    expect(r.x + r.width / 2).toBe(600);
    expect(r.y + r.height / 2).toBe(400);
  });
});

describe("dragRect", () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };

  it("moves by the pointer delta, clamped", () => {
    expect(dragRect(start, "move", 50, 20, vp)).toMatchObject({ x: 150, y: 120 });
    expect(dragRect(start, "move", 5000, 5000, vp)).toMatchObject({ x: 792, y: 492 });
  });

  it("resizes from the corner without moving, stopping at the edge", () => {
    expect(dragRect(start, "resize", 100, 50, vp)).toEqual({ ...start, width: 500, height: 350 });
    expect(dragRect(start, "resize", 5000, 5000, vp)).toEqual({
      ...start,
      width: 1092,
      height: 692,
    });
  });
});

describe("displayPath", () => {
  it("is relative inside the project, else the full path", () => {
    expect(displayPath("/p/src/a.ts", "/p")).toBe("src/a.ts");
    expect(displayPath("/p/src/a.ts", "/p/")).toBe("src/a.ts");
    expect(displayPath("/pp/a.ts", "/p")).toBe("/pp/a.ts");
    expect(displayPath("/w/a.ts")).toBe("/w/a.ts");
  });
});

describe("underRoot", () => {
  it("needs a folder boundary", () => {
    expect(underRoot("/p/a.ts", "/p")).toBe(true);
    expect(underRoot("/p/a.ts", "/p/")).toBe(true);
    expect(underRoot("/pp/a.ts", "/p")).toBe(false);
  });
});
