import { describe, expect, it } from "vitest";
import { dictationSettingsSchema } from "../schemas/settings";
import {
  chordFromEvent,
  DEFAULT_DICTATION_SETTINGS,
  DEFAULT_DICTATION_SHORTCUT,
  dictationSettingsOf,
  formatChord,
  isDictationPauseKey,
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

  it("input: the system default unless one was picked, a row saved before it existed included", () => {
    const { inputDeviceId: _, inputDeviceLabel: __, ...older } = DEFAULT_DICTATION_SETTINGS;
    expect(dictationSettingsOf(older).inputDeviceId).toBeNull();
    expect(dictationSettingsSchema.parse(older).inputDeviceId).toBeNull();
    const picked = { ...DEFAULT_DICTATION_SETTINGS, inputDeviceId: "abc", inputDeviceLabel: "USB" };
    expect(dictationSettingsSchema.safeParse(picked).success).toBe(true);
  });

  it("auto insert: off at 7 s by default, a row saved before it existed included", () => {
    const { autoInsert: _, autoInsertSilenceSec: __, ...older } = DEFAULT_DICTATION_SETTINGS;
    expect(dictationSettingsOf(older)).toMatchObject({
      autoInsert: false,
      autoInsertSilenceSec: 7,
    });
    expect(dictationSettingsSchema.parse(older)).toMatchObject({
      autoInsert: false,
      autoInsertSilenceSec: 7,
    });
    const odd = { ...DEFAULT_DICTATION_SETTINGS, autoInsertSilenceSec: 6 };
    expect(dictationSettingsSchema.safeParse(odd).success).toBe(false);
  });

  it("auto insert: the old auto-stop pause carries over at the nearest delay", () => {
    const { autoInsert: _, autoInsertSilenceSec: __, ...older } = DEFAULT_DICTATION_SETTINGS;
    expect(dictationSettingsOf({ ...older, autoStopSilenceSec: 3 })).toMatchObject({
      autoInsert: true,
      autoInsertSilenceSec: 5,
    });
    expect(dictationSettingsOf({ ...older, autoStopSilenceSec: 10 }).autoInsertSilenceSec).toBe(10);
    expect(dictationSettingsOf({ ...older, autoStopSilenceSec: 0 }).autoInsert).toBe(false);
    // Once saved, the new setting wins
    const saved = { ...DEFAULT_DICTATION_SETTINGS, autoStopSilenceSec: 3, autoInsert: false };
    expect(dictationSettingsOf(saved).autoInsert).toBe(false);
    expect(dictationSettingsOf(saved)).not.toHaveProperty("autoStopSilenceSec");
    expect(dictationSettingsSchema.safeParse(saved).success).toBe(true);
    const current = { ...DEFAULT_DICTATION_SETTINGS, autoInsert: true, autoInsertSilenceSec: 10 };
    expect(dictationSettingsOf(current as typeof DEFAULT_DICTATION_SETTINGS)).toEqual(current);
  });

  it("language: English by default, a row saved before it existed included", () => {
    const { language: _, ...older } = DEFAULT_DICTATION_SETTINGS;
    expect(dictationSettingsOf(older).language).toBe("en");
    expect(dictationSettingsSchema.parse(older).language).toBe("en");
    const es = { ...DEFAULT_DICTATION_SETTINGS, language: "es" };
    expect(dictationSettingsSchema.safeParse(es).success).toBe(true);
    const bad = { ...DEFAULT_DICTATION_SETTINGS, language: "xx" };
    expect(dictationSettingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("isDictationPauseKey", () => {
  it("is Cmd+P on macOS and Ctrl+Shift+P elsewhere", () => {
    expect(isDictationPauseKey(key("KeyP", { meta: true }), true)).toBe(true);
    expect(isDictationPauseKey(key("KeyP", { ctrl: true, shift: true }), false)).toBe(true);
  });

  it("leaves the palette, the terminal's Ctrl+P and other keys alone", () => {
    expect(isDictationPauseKey(key("KeyP", { meta: true, shift: true }), true)).toBe(false);
    expect(isDictationPauseKey(key("KeyP", { ctrl: true }), true)).toBe(false);
    expect(isDictationPauseKey(key("KeyP", { ctrl: true }), false)).toBe(false);
    expect(isDictationPauseKey(key("KeyP", { ctrl: true, shift: true, alt: true }), false)).toBe(
      false,
    );
    expect(isDictationPauseKey(key("KeyO", { meta: true }), true)).toBe(false);
  });
});
