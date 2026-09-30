import { describe, expect, it } from "vitest";
import { tuneWheelSensitivity } from "./tui-wheel";

const terminal = (mouseTrackingMode: string, scrollSensitivity = 1) => ({
  modes: { mouseTrackingMode },
  options: { scrollSensitivity },
});

describe("tuneWheelSensitivity", () => {
  it("boosts the wheel while a TUI tracks the mouse (trackpad swipes reach it)", () => {
    const t = terminal("any");
    tuneWheelSensitivity(t);
    expect(t.options.scrollSensitivity).toBe(3);
  });

  it("keeps the normal speed for the terminal's own scrollback, and restores it", () => {
    const plain = terminal("none");
    tuneWheelSensitivity(plain);
    expect(plain.options.scrollSensitivity).toBe(1);
    const back = terminal("none", 3);
    tuneWheelSensitivity(back);
    expect(back.options.scrollSensitivity).toBe(1);
  });
});
