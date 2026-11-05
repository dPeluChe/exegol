import { describe, expect, it } from "vitest";
import { tileCrop, tileStops } from "./full-page-tiles";

describe("tileStops", () => {
  it("steps by the visible height and covers the end", () => {
    expect(tileStops(2500, 844)).toEqual([0, 844, 1688]);
  });
  it("a page that fits is one tile", () => {
    expect(tileStops(600, 844)).toEqual([0]);
    expect(tileStops(0, 0)).toEqual([0]);
  });
});

describe("tileCrop", () => {
  const plan = { total: 2500, view: 844, offset: 0 };
  it("keeps the whole view for a full step", () => {
    expect(tileCrop(844, 844, plan, 2, 1688)).toEqual({ y: 0, height: 1688 });
  });
  it("keeps only the new rows when the last scroll was clamped", () => {
    // max scroll is 2500 - 844 = 1656, so the stop at 1688 shows rows from 1656
    expect(tileCrop(1688, 1656, plan, 2, 1688)).toEqual({ y: 64, height: 1624 });
  });
  it("never reads past the image", () => {
    expect(tileCrop(0, 0, { total: 900, view: 800, offset: 44 }, 1, 820)).toEqual({
      y: 44,
      height: 776,
    });
  });
  it("starts below a scroll container's top", () => {
    expect(tileCrop(0, 0, { total: 900, view: 800, offset: 44 }, 1, 900)).toEqual({
      y: 44,
      height: 800,
    });
  });
});
