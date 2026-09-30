import { describe, expect, it } from "vitest";
import { appChord, appKeys, chordBadge, chordKey, editKeys } from "./keymap";

const ev = (over: Partial<KeyboardEvent>) =>
  ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    key: "",
    code: "",
    ...over,
  }) as KeyboardEvent;

describe("appChord", () => {
  it("macOS: Cmd, with Shift and Option as variants; Ctrl alone is not the app's", () => {
    expect(appChord(ev({ metaKey: true }), true)).toEqual({ shift: false, alt: false });
    expect(appChord(ev({ metaKey: true, shiftKey: true }), true)).toEqual({
      shift: true,
      alt: false,
    });
    expect(appChord(ev({ ctrlKey: true }), true)).toBeNull();
  });

  it("Linux/Windows: Ctrl+Shift; Ctrl alone stays with the terminal; Alt is the variant", () => {
    expect(appChord(ev({ ctrlKey: true }), false)).toBeNull();
    expect(appChord(ev({ ctrlKey: true, shiftKey: true }), false)).toEqual({
      shift: false,
      alt: false,
    });
    expect(appChord(ev({ ctrlKey: true, shiftKey: true, altKey: true }), false)).toEqual({
      shift: true,
      alt: true,
    });
  });
});

describe("chordKey", () => {
  it("reads the physical key for digits and punctuation, the letter otherwise", () => {
    expect(chordKey(ev({ key: "@", code: "Digit2" }))).toBe("2");
    expect(chordKey(ev({ key: "}", code: "BracketRight" }))).toBe("]");
    expect(chordKey(ev({ key: "<", code: "Comma" }))).toBe(",");
    expect(chordKey(ev({ key: "D", code: "KeyD" }))).toBe("d");
  });
});

describe("appKeys", () => {
  it("macOS keeps its notation", () => {
    expect(appKeys("Cmd+Shift+D", true)).toBe("Cmd+Shift+D");
    expect(appKeys("⌘⇧D", true)).toBe("⌘⇧D");
  });

  it("elsewhere Cmd is Ctrl+Shift, and its Shift/Option variants Ctrl+Shift+Alt", () => {
    expect(appKeys("Launch an agent with Cmd+N.", false)).toBe(
      "Launch an agent with Ctrl+Shift+N.",
    );
    expect(appKeys("Cmd+Shift+D", false)).toBe("Ctrl+Shift+Alt+D");
    expect(appKeys("Cmd+Option+1-9", false)).toBe("Ctrl+Shift+Alt+1-9");
    expect(appKeys("Ctrl+Tab (or Cmd+] / Cmd+[)", false)).toBe(
      "Ctrl+Tab (or Ctrl+Shift+] / Ctrl+Shift+[)",
    );
    expect(appKeys("⌘⇧D", false)).toBe("Ctrl+Shift+Alt+D");
    expect(appKeys("⌘↓", false)).toBe("Ctrl+Shift+Down");
  });
});

describe("editKeys / chordBadge", () => {
  it("text editing keeps plain Ctrl off macOS", () => {
    expect(editKeys("Cmd+Enter", false)).toBe("Ctrl+Enter");
    expect(editKeys("Cmd+click a link", true)).toBe("Cmd+click a link");
  });
  it("badges", () => {
    expect(chordBadge("2", true)).toBe("⌘2");
    expect(chordBadge("2", false)).toBe("^⇧2");
  });
});
