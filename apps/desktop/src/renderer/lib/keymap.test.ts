import { describe, expect, it } from "vitest";
import {
  appChord,
  appKeys,
  chordBadge,
  chordKey,
  editKeys,
  fileManagerLabel,
  hasClickModifier,
  windowKey,
} from "./keymap";

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

describe("windowKey", () => {
  const chord = { ctrlKey: true, shiftKey: true };

  it("off macOS: Ctrl+Shift+= / - zoom, Ctrl+Shift+Alt+0 resets, Ctrl+Shift+Q quits", () => {
    expect(windowKey(ev({ ...chord, code: "Equal", key: "+" }), false)).toBe("in");
    expect(windowKey(ev({ ...chord, code: "Minus", key: "_" }), false)).toBe("out");
    expect(windowKey(ev({ ...chord, altKey: true, code: "Digit0", key: ")" }), false)).toBe(
      "reset",
    );
    expect(windowKey(ev({ ...chord, code: "KeyQ", key: "Q" }), false)).toBe("quit");
  });

  it("leaves Ctrl+Shift+0 to the projects, Ctrl alone to the terminal, macOS to its menu", () => {
    expect(windowKey(ev({ ...chord, code: "Digit0", key: ")" }), false)).toBeNull();
    expect(windowKey(ev({ ctrlKey: true, code: "Equal", key: "=" }), false)).toBeNull();
    expect(windowKey(ev({ ctrlKey: true, code: "KeyQ", key: "q" }), false)).toBeNull();
    expect(windowKey(ev({ metaKey: true, code: "KeyQ", key: "q" }), true)).toBeNull();
  });
});

describe("hasClickModifier", () => {
  const click = (metaKey: boolean, ctrlKey: boolean) => ({ metaKey, ctrlKey });
  it("is Cmd on macOS and Ctrl elsewhere", () => {
    expect(hasClickModifier(click(true, false), true)).toBe(true);
    expect(hasClickModifier(click(false, true), true)).toBe(false);
    expect(hasClickModifier(click(false, true), false)).toBe(true);
    expect(hasClickModifier(click(true, false), false)).toBe(false);
  });
});

describe("fileManagerLabel", () => {
  it("names the file manager per platform", () => {
    expect(fileManagerLabel("darwin")).toBe("Finder");
    expect(fileManagerLabel("win32")).toBe("Explorer");
    expect(fileManagerLabel("linux")).toBe("File manager");
  });
});
