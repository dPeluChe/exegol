import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("HeadlessEmulator.snapshot", () => {
  it("replays an alt-screen TUI with nothing of the shell behind its blank cells", async () => {
    const e = new HeadlessEmulator(20, 4);
    e.write("% ls\r\nfoo.ds\r\n% opencode\r\n\x1b[?1049h\x1b[2J\x1b[1;3Hframe\x1b[3;3Hframe");
    await settle();

    const view = new Terminal({ cols: 20, rows: 4, allowProposedApi: true });
    await new Promise<void>((done) => view.write(e.snapshot() ?? "", done));
    const screen = [0, 1, 2, 3].map((y) => view.buffer.active.getLine(y)?.translateToString(true));

    expect(view.buffer.active.type).toBe("alternate");
    expect(screen).toEqual(["  frame", "", "  frame", ""]);
    view.dispose();
    e.dispose();
  });
});

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

  it("a sequence split across writes still counts, at any position (T138)", async () => {
    const seq = "\x1b[?1049h\x1b[?2004h";
    for (let at = 1; at < seq.length; at++) {
      const e = new HeadlessEmulator(80, 24);
      e.write(seq.slice(0, at));
      e.write(seq.slice(at));
      await e.afterParsed(1000, () => undefined);
      expect(e.alternateScreen).toBe(true);
      expect(e.modeSequence()).toBe("\x1b[?2004h");
      e.dispose();
    }
  });

  it("several modes in one sequence, and a reset clears them", async () => {
    const e = new HeadlessEmulator(80, 24);
    e.write("\x1b[?1049;1000;1006h");
    await e.afterParsed(1000, () => undefined);
    expect(e.alternateScreen).toBe(true);
    expect(e.modeSequence()).toBe("\x1b[?1000h\x1b[?1006h");
    e.write("\x1b[?1000;1006l");
    await e.afterParsed(1000, () => undefined);
    expect(e.modeSequence()).toBe("");
    e.write("\x1b[?2004h\x1bc");
    await e.afterParsed(1000, () => undefined);
    expect(e.alternateScreen).toBe(false);
    expect(e.modeSequence()).toBe("");
    e.dispose();
  });
});
