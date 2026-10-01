import { describe, expect, it } from "vitest";
import { compareSizes, parseSize, sizeKey, toHttpUrl } from "./browser-viewports";

describe("page sizes", () => {
  it("parses W x H, with an optional name", () => {
    expect(parseSize("390x844")).toEqual({ label: "390×844", width: 390, height: 844 });
    expect(parseSize(" 1920 × 1080 ", "Full HD")).toEqual({
      label: "Full HD",
      width: 1920,
      height: 1080,
    });
  });
  it("refuses what is not a usable size", () => {
    for (const bad of ["", "abc", "10x10", "390", "99999x800"]) expect(parseSize(bad)).toBeNull();
  });
  it("travels as WxH", () => {
    expect(sizeKey({ width: 768, height: 1024 })).toBe("768x1024");
  });
});

describe("compareSizes", () => {
  it("starts with the size shown now, then desktop, tablet and mobile without repeating it", () => {
    const mobile = { label: "Mobile", width: 390, height: 844 };
    expect(compareSizes(mobile).map((s) => s.width)).toEqual([390, 1440, 768]);
    expect(compareSizes(undefined).map((s) => s.width)).toEqual([1440, 768, 390]);
  });
});

describe("toHttpUrl", () => {
  it("adds http:// to a bare host, keeps a full URL", () => {
    expect(toHttpUrl(" localhost:3000/x ")).toBe("http://localhost:3000/x");
    expect(toHttpUrl("https://a.dev")).toBe("https://a.dev");
  });
});
