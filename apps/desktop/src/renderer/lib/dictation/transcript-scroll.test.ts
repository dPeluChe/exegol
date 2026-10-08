import { describe, expect, it } from "vitest";
import { clippedAbove, shouldFollow, wordCount } from "./transcript-scroll";

const box = (scrollTop: number, scrollHeight = 400, clientHeight = 120) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("shouldFollow", () => {
  it("follows at the bottom and when the text still fits", () => {
    expect(shouldFollow(box(280))).toBe(true);
    expect(shouldFollow(box(0, 80, 80))).toBe(true);
  });

  it("tolerates subpixel rounding near the end", () => {
    expect(shouldFollow(box(270.5))).toBe(true);
  });

  it("stops following once the user scrolls up", () => {
    expect(shouldFollow(box(200))).toBe(false);
    expect(shouldFollow(box(0))).toBe(false);
  });

  it("on a 5+ minute transcript, follows only from the end", () => {
    expect(shouldFollow(box(19_880, 20_000))).toBe(true);
    expect(shouldFollow(box(19_000, 20_000))).toBe(false);
  });
});

describe("clippedAbove", () => {
  it("is true only once text sits above the view", () => {
    expect(clippedAbove(box(0))).toBe(false);
    expect(clippedAbove(box(0.5))).toBe(false);
    expect(clippedAbove(box(40))).toBe(true);
  });
});

describe("wordCount", () => {
  it("counts words across spaces and line breaks", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("hello")).toBe(1);
    expect(wordCount("  hello  big\nworld ")).toBe(3);
  });
});
