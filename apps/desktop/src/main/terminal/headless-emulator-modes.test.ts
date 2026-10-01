import { describe, expect, it } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("HeadlessEmulator.modeSequence", () => {
  it("gives back the modes a TUI turned on (mouse, SGR, bracketed paste, hidden cursor)", async () => {
    const e = new HeadlessEmulator(80, 24);
    e.write("\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?25lhello");
    await settle();
    expect(e.modeSequence()).toBe("\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h");
    e.dispose();
  });

  it("nothing for a plain shell, and a mode turned off again is gone", async () => {
    const e = new HeadlessEmulator(80, 24);
    e.write("\x1b[?2004h$ \x1b[?2004l");
    await settle();
    expect(e.modeSequence()).toBe("");
    e.dispose();
  });
});
