import { describe, expect, it } from "vitest";
import { isLongMessage, keepLineBreaks } from "./inbox-text";

describe("inbox message text", () => {
  it("keeps single line breaks, leaves paragraphs and fenced code alone", () => {
    expect(keepLineBreaks("one\ntwo\n\nthree")).toBe("one  \ntwo\n\nthree");
    expect(keepLineBreaks("```\na\nb\n```\nafter\nit")).toBe("```\na\nb\n```  \nafter  \nit");
  });

  it("calls a message long by characters or by lines", () => {
    expect(isLongMessage("short\nnote")).toBe(false);
    expect(isLongMessage("x".repeat(901))).toBe(true);
    expect(isLongMessage("a\n".repeat(15))).toBe(true);
  });
});
