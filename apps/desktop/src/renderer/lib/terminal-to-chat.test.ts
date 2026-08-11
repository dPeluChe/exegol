import { describe, expect, it } from "vitest";
import { parseTerminalToChat } from "./terminal-to-chat";

const ESC = "";

describe("parseTerminalToChat ANSI stripping", () => {
  it("strips truecolor SGR and cursor-forward sequences", () => {
    const raw = `${ESC}[38;2;153;153;153m* Baked for 1s${ESC}[0m\n${ESC}[38;2;255;255;255m>${ESC}[1C hola${ESC}[39m`;
    const turns = parseTerminalToChat(raw);
    const all = turns.map((t) => t.content).join("\n");
    expect(all).not.toMatch(/\[38;2/);
    expect(all).not.toMatch(/\[1C/);
    // Spinner timings render as header meta, not message content (15fbcf7)
    expect(turns.some((t) => t.meta?.includes("Baked for 1s"))).toBe(true);
    expect(all).toContain("hola");
  });

  it("strips OSC title sequences", () => {
    const raw = `${ESC}]0;window titleagent says hi`;
    const all = parseTerminalToChat(raw)
      .map((t) => t.content)
      .join("\n");
    expect(all).toBe("agent says hi");
  });

  it("keeps plain multiline text intact", () => {
    const turns = parseTerminalToChat("line one\nline two");
    expect(turns[0]?.content).toContain("line one");
    expect(turns[0]?.content).toContain("line two");
  });
});
