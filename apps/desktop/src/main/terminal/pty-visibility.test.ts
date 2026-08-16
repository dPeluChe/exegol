import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeMissedOutput,
  forgetTerminalViewers,
  hasVisibleViewer,
  noteOutputDropped,
  setTerminalViewerVisible,
} from "./pty-visibility";

describe("terminal visibility gate", () => {
  beforeEach(() => {
    for (const id of ["a", "b"]) forgetTerminalViewers(id);
  });

  it("treats an agent nobody reported on as visible", () => {
    // Fail open: an older renderer, a race or a bug must never silence a
    // terminal. The gate can only ever be an optimisation.
    expect(hasVisibleViewer("never-reported")).toBe(true);
  });

  it("stops shipping output once every view reports hidden", () => {
    setTerminalViewerVisible("a", true);
    expect(hasVisibleViewer("a")).toBe(true);
    setTerminalViewerVisible("a", false);
    expect(hasVisibleViewer("a")).toBe(false);
  });

  it("counts views, so one hiding does not silence another", () => {
    // A pane and a floating window can show the same agent.
    setTerminalViewerVisible("a", true);
    setTerminalViewerVisible("a", true);
    setTerminalViewerVisible("a", false);
    expect(hasVisibleViewer("a")).toBe(true);
    setTerminalViewerVisible("a", false);
    expect(hasVisibleViewer("a")).toBe(false);
  });

  it("never drops below zero when a view reports hidden twice", () => {
    setTerminalViewerVisible("a", true);
    setTerminalViewerVisible("a", false);
    setTerminalViewerVisible("a", false);
    setTerminalViewerVisible("a", true);
    // Two spurious hides must not require two shows to recover.
    expect(hasVisibleViewer("a")).toBe(true);
  });

  it("reports missed output exactly once, so a repaint happens per gap", () => {
    noteOutputDropped("a");
    expect(consumeMissedOutput("a")).toBe(true);
    expect(consumeMissedOutput("a")).toBe(false);
  });

  it("forgets an agent entirely, so a closed pane leaves no phantom hidden view", () => {
    setTerminalViewerVisible("a", false);
    noteOutputDropped("a");
    forgetTerminalViewers("a");
    expect(hasVisibleViewer("a")).toBe(true);
    expect(consumeMissedOutput("a")).toBe(false);
  });
});
