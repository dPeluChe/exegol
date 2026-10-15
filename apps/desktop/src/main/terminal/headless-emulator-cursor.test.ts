import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("HeadlessEmulator.snapshot cursor", () => {
  it("a replay puts the cursor where the program left it after cells skipped with CUF", async () => {
    const e = new HeadlessEmulator(40, 6);
    e.write("> hola\x1b[Cmundo\x1b[C");
    await settle();
    const t = new Terminal({ cols: 40, rows: 6, allowProposedApi: true });
    await new Promise<void>((r) => t.write(e.snapshot() ?? "", r));
    t.write("x");
    await new Promise<void>((r) => t.write("", r));
    expect(t.buffer.active.getLine(0)?.translateToString(true)).toBe("> hola mundo x");
    e.dispose();
    t.dispose();
  });
});
