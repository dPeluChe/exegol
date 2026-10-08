import { describe, expect, it } from "vitest";
import { awaitsRepaint } from "./reattach-repaint";

const model = { cols: 100, rows: 30 };
const tui = { tui: true, alternateScreen: false };

describe("awaitsRepaint", () => {
  it("waits when a TUI's frame is reflowed to another size", () => {
    expect(awaitsRepaint(model, { cols: 140, rows: 30 }, tui)).toBe(true);
    expect(awaitsRepaint(model, { cols: 100, rows: 40 }, tui)).toBe(true);
  });

  it("waits for an alternate-screen program even in a plain terminal", () => {
    const vim = { tui: false, alternateScreen: true };
    expect(awaitsRepaint(model, { cols: 140, rows: 30 }, vim)).toBe(true);
  });

  it("does not wait without a new size, at the same size, or for a shell", () => {
    expect(awaitsRepaint(model, undefined, tui)).toBe(false);
    expect(awaitsRepaint(model, { cols: 100, rows: 30 }, tui)).toBe(false);
    const shell = { tui: false, alternateScreen: false };
    expect(awaitsRepaint(model, { cols: 140, rows: 30 }, shell)).toBe(false);
  });
});
