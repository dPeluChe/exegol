import { describe, expect, it } from "vitest";
import { keyInput, textInputs, typeable } from "./simulator-keys";

const key = (
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => keyInput({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("typeable", () => {
  it("types only US printable keys", () => {
    expect(typeable("a")).toBe(true);
    expect(typeable("~")).toBe(true);
    expect(typeable(" ")).toBe(true);
    expect(typeable("é")).toBe(false);
    expect(typeable("Enter")).toBe(false);
  });
});

describe("keyInput", () => {
  it("keeps what Option types on a Spanish layout", () => {
    for (const ch of ["@", "#", "[", "]", "{", "}", "\\", "|"]) {
      expect(key(ch, { altKey: true })).toEqual({ text: ch });
    }
  });

  it("leaves Cmd and Ctrl combos to the app", () => {
    expect(key("v", { metaKey: true })).toBeNull();
    expect(key("c", { ctrlKey: true })).toBeNull();
  });

  it("sends the special keys as keys, not with Option", () => {
    expect(key("Enter")).toEqual({ key: "Enter" });
    expect(key("Backspace", { altKey: true })).toBeNull();
    expect(key("Dead", { altKey: true })).toBeNull();
  });
});

describe("textInputs", () => {
  it("cuts long text into calls AXe accepts", () => {
    const steps = textInputs("x".repeat(1_201), 500);
    expect(steps.map((s) => ("text" in s ? s.text.length : 0))).toEqual([500, 500, 201]);
  });

  it("keeps the lines of a paste apart with Return", () => {
    expect(textInputs("one\r\ntwo\n\nthree\tend")).toEqual([
      { text: "one" },
      { key: "Enter" },
      { text: "two" },
      { key: "Enter" },
      { key: "Enter" },
      { text: "three" },
      { key: "Tab" },
      { text: "end" },
    ]);
  });

  it("drops what a US keyboard cannot type", () => {
    expect(textInputs("café")).toEqual([{ text: "caf" }]);
    expect(textInputs("")).toEqual([]);
  });
});
