import { describe, expect, it } from "vitest";
import { clippedAbove, shouldFollow, unannounced, wordCount } from "./transcript-scroll";

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

describe("unannounced", () => {
  it("reads only the words added since the last announcement", () => {
    expect(unannounced("", "hello there")).toBe("hello there");
    expect(unannounced("hello there", "hello there. next phrase")).toBe(". next phrase");
    expect(unannounced("hello there", "hello there")).toBe("");
  });

  it("reads it all again when a streaming model rewrote earlier words", () => {
    expect(unannounced("hello their", "hello there now")).toBe("hello there now");
  });
});
