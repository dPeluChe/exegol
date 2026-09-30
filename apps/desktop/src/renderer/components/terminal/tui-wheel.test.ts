import { describe, expect, it } from "vitest";
import { tuneWheelSensitivity } from "./tui-wheel";

const terminal = (mouseTrackingMode: string, scrollSensitivity = 1) => ({
  modes: { mouseTrackingMode },
  options: { scrollSensitivity },
});
const swipe = { deltaMode: 0, deltaY: 4 };

describe("tuneWheelSensitivity", () => {
  it("boosts trackpad deltas while a TUI tracks the mouse (swipes reach it)", () => {
    const t = terminal("any");
    tuneWheelSensitivity(t, swipe);
    expect(t.options.scrollSensitivity).toBe(3);
  });

  it("a mouse wheel notch or a line-mode wheel keeps the normal speed", () => {
    const notch = terminal("any", 3);
    tuneWheelSensitivity(notch, { deltaMode: 0, deltaY: 100 });
    expect(notch.options.scrollSensitivity).toBe(1);
    const lines = terminal("any", 3);
    tuneWheelSensitivity(lines, { deltaMode: 1, deltaY: 3 });
    expect(lines.options.scrollSensitivity).toBe(1);
  });

  it("keeps the normal speed for the terminal's own scrollback, and restores it", () => {
    const plain = terminal("none");
    tuneWheelSensitivity(plain, swipe);
    expect(plain.options.scrollSensitivity).toBe(1);
    const back = terminal("none", 3);
    tuneWheelSensitivity(back, swipe);
    expect(back.options.scrollSensitivity).toBe(1);
  });
});
