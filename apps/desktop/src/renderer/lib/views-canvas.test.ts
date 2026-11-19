import { describe, expect, it } from "vitest";
import { cardHeight, fitCamera, zoomAt } from "./views-canvas";

describe("views canvas", () => {
  it("keeps the point under the pointer while zooming, within the limits", () => {
    const cam = zoomAt({ x: 10, y: 20, k: 1 }, 110, 220, 2);
    expect(cam).toEqual({ k: 2, x: -90, y: -180 });
    expect((110 - cam.x) / cam.k).toBe(100);
    expect(zoomAt(cam, 0, 0, 10).k).toBe(2);
  });

  it("fits the tree centered and never enlarges it", () => {
    expect(fitCamera({ width: 2000, height: 500 }, { width: 1064, height: 600 })).toEqual({
      k: 0.5,
      x: 32,
      y: 175,
    });
    expect(fitCamera({ width: 100, height: 100 }, { width: 1000, height: 1000 }).k).toBe(1);
  });

  it("sizes a card by its thumbnail, a screen tall until captured", () => {
    expect(cardHeight(undefined)).toBe(135 + 52);
    expect(
      cardHeight({
        path: "/",
        sources: [],
        status: "done",
        inSitemap: false,
        robotsBlocked: false,
        width: 960,
        height: 960,
      }),
    ).toBe(240 + 52);
  });
});
