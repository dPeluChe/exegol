import { describe, expect, it } from "vitest";
import { dictationSettingsSchema } from "../schemas/settings";
import {
  chordFromEvent,
  DEFAULT_DICTATION_SETTINGS,
  DEFAULT_DICTATION_SHORTCUT,
  dictationSettingsOf,
  formatChord,
  matchesChord,
  parseChord,
  releasesChord,
} from "./dictation";

const key = (code: string, mods: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>>) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe("dictation chord", () => {
  const chord = parseChord(DEFAULT_DICTATION_SHORTCUT);
  if (!chord) throw new Error("default chord does not parse");

  it("is Cmd+Shift+Space on macOS and Ctrl+Shift+Space elsewhere", () => {
    expect(formatChord(chord, true)).toBe("Cmd+Shift+Space");
    expect(formatChord(chord, false)).toBe("Ctrl+Shift+Space");
    expect(matchesChord(key("Space", { meta: true, shift: true }), chord, true)).toBe(true);
    expect(matchesChord(key("Space", { ctrl: true, shift: true }), chord, false)).toBe(true);
  });

  it("refuses the near misses", () => {
    expect(matchesChord(key("Space", { meta: true }), chord, true)).toBe(false);
    expect(matchesChord(key("Space", { ctrl: true, shift: true }), chord, true)).toBe(false);
    expect(matchesChord(key("Space", { meta: true, shift: true, alt: true }), chord, true)).toBe(
      false,
    );
    expect(matchesChord(key("Space", { meta: true, ctrl: true, shift: true }), chord, false)).toBe(
      false,
    );
    expect(matchesChord(key("KeyD", { meta: true, shift: true }), chord, true)).toBe(false);
  });

  it("needs Cmd or Ctrl and one known key", () => {
    expect(parseChord("Shift+Space")).toBeNull();
    expect(parseChord("Cmd+Shift")).toBeNull();
    expect(parseChord("Cmd+Hyper+K")).toBeNull();
    expect(parseChord("Cmd+Option+D")).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: true,
      code: "KeyD",
    });
  });

  it("records a pressed chord in the stored notation, Ctrl as Cmd off macOS", () => {
    expect(chordFromEvent(key("Space", { meta: true, shift: true }), true)).toBe("Cmd+Shift+Space");
    expect(chordFromEvent(key("Space", { ctrl: true, shift: true }), false)).toBe(
      "Cmd+Shift+Space",
    );
    expect(chordFromEvent(key("KeyM", { alt: true }), true)).toBeNull();
    expect(chordFromEvent(key("ShiftLeft", { meta: true, shift: true }), true)).toBeNull();
  });

  it("ends a hold on the key or any of its modifiers", () => {
    expect(releasesChord({ key: " ", code: "Space" }, chord, true)).toBe(true);
    expect(releasesChord({ key: "Meta", code: "MetaLeft" }, chord, true)).toBe(true);
    expect(releasesChord({ key: "Shift", code: "ShiftLeft" }, chord, true)).toBe(true);
    expect(releasesChord({ key: "Alt", code: "AltLeft" }, chord, true)).toBe(false);
    expect(releasesChord({ key: "Control", code: "ControlLeft" }, chord, false)).toBe(true);
  });

  it("validates the stored settings", () => {
    expect(dictationSettingsSchema.safeParse(DEFAULT_DICTATION_SETTINGS).success).toBe(true);
    expect(
      dictationSettingsSchema.safeParse({ ...DEFAULT_DICTATION_SETTINGS, shortcut: "Space" })
        .success,
    ).toBe(false);
  });

  it("overlay position: over the pane by default, a row saved before it existed included", () => {
    const { overlayPosition: _, ...older } = DEFAULT_DICTATION_SETTINGS;
    expect(dictationSettingsOf(older).overlayPosition).toBe("pane");
    expect(dictationSettingsSchema.parse(older).overlayPosition).toBe("pane");
    const docked = { ...DEFAULT_DICTATION_SETTINGS, overlayPosition: "titlebar" };
    expect(dictationSettingsSchema.safeParse(docked).success).toBe(true);
    const bad = { ...DEFAULT_DICTATION_SETTINGS, overlayPosition: "corner" };
    expect(dictationSettingsSchema.safeParse(bad).success).toBe(false);
  });
});
