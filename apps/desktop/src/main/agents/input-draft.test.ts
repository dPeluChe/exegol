import { describe, expect, it } from "vitest";
import { draftLengthAfter, inputShape } from "./input-draft";

describe("draftLengthAfter", () => {
  it("counts typed text and deletes", () => {
    expect(draftLengthAfter(0, "hola")).toBe(4);
    expect(draftLengthAfter(4, "\x7f")).toBe(3);
    expect(draftLengthAfter(0, "\x7f")).toBe(0);
  });

  it("empties on submit, Ctrl+C and Ctrl+U", () => {
    for (const key of ["\r", "\x03", "\x15"]) expect(draftLengthAfter(9, key)).toBe(0);
    expect(draftLengthAfter(0, "hola\rmas")).toBe(3);
  });

  it("keeps a new line as text", () => {
    expect(draftLengthAfter(2, "\n")).toBe(3);
  });

  it("counts a bracketed paste, even with a return inside", () => {
    expect(draftLengthAfter(0, "\x1b[200~ab\rcd\x1b[201~")).toBe(5);
  });

  it("sees the Enter sent with a paste", () => {
    expect(draftLengthAfter(0, "\x1b[200~a\nb\x1b[201~\r")).toBe(0);
  });

  it("ignores keys and mouse events", () => {
    for (const seq of ["\x1b", "\x1b[Mabc"]) expect(draftLengthAfter(3, seq)).toBe(3);
  });

  it("does not count a terminal reply mixed with typing", () => {
    expect(draftLengthAfter(0, "ab\x1b[3;1R")).toBe(2);
  });
});

describe("inputShape", () => {
  it("gives sizes and control codes, never the text", () => {
    expect(inputShape("hola\x17")).toBe("5 char(s), 4 printable, controls 0x17");
    expect(inputShape("\x1b[Ia")).toBe("1 char(s), 1 printable");
  });
});
