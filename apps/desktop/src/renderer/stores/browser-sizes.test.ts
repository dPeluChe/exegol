import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserSizesStore } from "./browser-sizes";

const size = (w: number, h: number, label = "x") => ({ label, width: w, height: h });

describe("custom browser sizes", () => {
  beforeEach(() => useBrowserSizesStore.setState({ custom: [] }));

  it("adding the same size again renames it instead of listing it twice", () => {
    const { add } = useBrowserSizesStore.getState();
    add(size(1920, 1080, "Full HD"));
    add(size(1920, 1080, "TV"));
    expect(useBrowserSizesStore.getState().custom).toEqual([size(1920, 1080, "TV")]);
  });

  it("removes by size", () => {
    const { add, remove } = useBrowserSizesStore.getState();
    add(size(1920, 1080));
    add(size(360, 640));
    remove(size(1920, 1080, "whatever"));
    expect(useBrowserSizesStore.getState().custom).toEqual([size(360, 640)]);
  });
});
