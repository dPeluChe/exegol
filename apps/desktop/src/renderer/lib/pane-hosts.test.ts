import { describe, expect, it } from "vitest";
import { hostBox } from "./pane-hosts";

describe("pane hosts", () => {
  it("places a host over its slot, relative to the layer", () => {
    expect(
      hostBox(
        { left: 340.5, top: 80, width: 600.5, height: 400 },
        { left: 240, top: 40, width: 1200, height: 800 },
      ),
    ).toEqual({ left: 100.5, top: 40, width: 600.5, height: 400 });
  });
});
