import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, FLAT_PEAK, inputOptions, isFlat, peakOf, resolveInput } from "./inputs";

const mic = (deviceId: string, label = "", groupId = "") => ({
  kind: "audioinput",
  deviceId,
  label,
  groupId,
});
const none = { id: null, label: null };

describe("inputOptions", () => {
  it("lists the system default first, then each mic, without Chromium's aliases or outputs", () => {
    const { options, unlabeled } = inputOptions(
      [
        mic("default", "Default - MacBook Mic"),
        mic("a", "MacBook Mic"),
        mic("b", "USB Mic"),
        { kind: "audiooutput", deviceId: "o", label: "Speakers" },
      ],
      none,
    );
    expect(options).toEqual([
      { id: DEFAULT_INPUT, name: "System default" },
      { id: "a", name: "MacBook Mic" },
      { id: "b", name: "USB Mic" },
    ]);
    expect(unlabeled).toBe(false);
  });

  it("names unlabeled mics by number and says labels need the mic allowed", () => {
    const { options, unlabeled } = inputOptions([mic("a"), mic("b")], none);
    expect(options.map((o) => o.name)).toEqual(["System default", "Microphone 1", "Microphone 2"]);
    expect(unlabeled).toBe(true);
  });

  it("keeps a picked mic that is unplugged, by its saved name", () => {
    const { options } = inputOptions([mic("a", "MacBook Mic")], { id: "gone", label: "USB Mic" });
    expect(options.at(-1)).toEqual({ id: "gone", name: "USB Mic (not connected)" });
  });
});

describe("resolveInput", () => {
  const usb = { id: "old", label: "USB Mic", groupId: "g1" };

  it("keeps the saved id while it is listed, and the default when none was picked", () => {
    expect(resolveInput([mic("old", "USB Mic")], usb)).toEqual({ id: "old", relinked: false });
    expect(resolveInput([mic("a", "USB Mic")], none)).toEqual({ id: null, relinked: false });
  });

  it("finds a mic with a new id by its group first, then by its label", () => {
    expect(resolveInput([mic("new", "USB Mic (2)", "g1"), mic("b", "USB Mic")], usb)).toEqual({
      id: "new",
      relinked: true,
    });
    expect(resolveInput([mic("new", "USB Mic", "g9"), mic("b", "Other")], usb)).toEqual({
      id: "new",
      relinked: true,
    });
  });

  it("never guesses between two mics of that label: not connected", () => {
    const twins = [mic("x", "USB Mic", "g8"), mic("y", "USB Mic", "g9")];
    expect(resolveInput(twins, usb)).toEqual({ id: "old", relinked: false });
    expect(resolveInput([mic("z", "Other")], usb)).toEqual({ id: "old", relinked: false });
  });

  it("keeps the saved id when no mic is listed yet (before the mic was allowed)", () => {
    expect(resolveInput([mic("", "")], usb)).toEqual({ id: "old", relinked: false });
  });

  it("shows the relinked mic as selected in the options", () => {
    const { options, value } = inputOptions([mic("new", "USB Mic")], usb);
    expect(value).toBe("new");
    expect(options.some((o) => o.name.includes("not connected"))).toBe(false);
  });
});

describe("flat audio", () => {
  it("takes the peak across chunks, sign ignored", () => {
    const peak = peakOf(new Float32Array([0.001, -0.3]), peakOf(new Float32Array([0.1])));
    expect(peak).toBeCloseTo(0.3);
  });

  it("is flat only below the threshold for the whole dictation", () => {
    expect(isFlat(0)).toBe(true);
    expect(isFlat(FLAT_PEAK / 2)).toBe(true);
    expect(isFlat(FLAT_PEAK)).toBe(false);
    expect(isFlat(0.05)).toBe(false);
  });
});
