import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";

// The renderer's view loads the same addon (renderer/components/terminal/unicode-widths.ts)
function view(cols: number, rows: number): Terminal {
  const t = new Terminal({ cols, rows, allowProposedApi: true });
  t.loadAddon(new Unicode11Addon());
  t.unicode.activeVersion = "11";
  return t;
}

const write = (t: Terminal, data: string) => new Promise<void>((r) => t.write(data, r));

describe("HeadlessEmulator cell widths", () => {
  it("puts emoji in two cells, as the view and the CLI do", async () => {
    const e = new HeadlessEmulator(80, 4);
    await e.writeParsed("• ✅ listo 🚀 → ¿qué? — ⚡ fin");
    const t = view(80, 4);
    await write(t, e.snapshot() ?? "");
    expect(t.buffer.active.cursorX).toBe(30);
    e.dispose();
    t.dispose();
  });

  it("a snapshot with emoji keeps the cursor: the CLI's next relative move lands where it meant", async () => {
    const e = new HeadlessEmulator(40, 4);
    await e.writeParsed("✅ hecho 🚀 ok");
    const t = view(40, 4);
    await write(t, e.snapshot() ?? "");
    await write(t, "\x1b[3DXY");
    expect(t.buffer.active.getLine(0)?.translateToString(true)).toBe("✅ hecho 🚀XYk");
    e.dispose();
    t.dispose();
  });
});
