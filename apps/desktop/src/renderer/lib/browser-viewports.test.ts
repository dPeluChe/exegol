import { describe, expect, it } from "vitest";
import { viewportSize } from "./browser-viewports";

describe("viewportSize", () => {
  it("a device size, or none to fit the pane", () => {
    expect(viewportSize("mobile")).toEqual({ width: 390, height: 844 });
    expect(viewportSize("fit")).toBeNull();
    expect(viewportSize(undefined)).toBeNull();
  });
});
