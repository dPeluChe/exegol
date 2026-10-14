import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, inputOptions } from "./inputs";

const mic = (deviceId: string, label = "") => ({ kind: "audioinput", deviceId, label });
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
