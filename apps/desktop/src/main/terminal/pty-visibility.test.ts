import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeMissedOutput,
  forgetTerminalViewers,
  forgetViewer,
  hasVisibleViewer,
  noteOutputDropped,
  setTerminalViewerVisible,
} from "./pty-visibility";

const PANE = 1;
const FLOATING = 2;

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
    setTerminalViewerVisible("a", PANE, true);
    expect(hasVisibleViewer("a")).toBe(true);
    setTerminalViewerVisible("a", PANE, false);
    expect(hasVisibleViewer("a")).toBe(false);
  });

  it("tracks views separately, so one hiding does not silence another", () => {
    // A pane and a floating window can show the same agent.
    setTerminalViewerVisible("a", PANE, true);
    setTerminalViewerVisible("a", FLOATING, true);
    setTerminalViewerVisible("a", PANE, false);
    expect(hasVisibleViewer("a")).toBe(true);
    setTerminalViewerVisible("a", FLOATING, false);
    expect(hasVisibleViewer("a")).toBe(false);
  });

  it("is idempotent — repeated reports from one view say the same thing", () => {
    // The counter version needed a clamp here; identity makes it structural.
    setTerminalViewerVisible("a", PANE, true);
    setTerminalViewerVisible("a", PANE, true);
    setTerminalViewerVisible("a", PANE, false);
    expect(hasVisibleViewer("a")).toBe(false);
  });

  it("drops a window's views when it is destroyed, so a reload cannot leak", () => {
    // A renderer reload never sends "hidden" for what it was showing. Without
    // this the gate silently degrades to a no-op after one Cmd+R.
    setTerminalViewerVisible("a", PANE, true);
    setTerminalViewerVisible("b", PANE, true);
    forgetViewer(PANE);
    expect(hasVisibleViewer("a")).toBe(false);
    expect(hasVisibleViewer("b")).toBe(false);
  });

  it("reports missed output exactly once, so a repaint happens per gap", () => {
    noteOutputDropped("a");
    expect(consumeMissedOutput("a")).toBe(true);
    expect(consumeMissedOutput("a")).toBe(false);
  });

  it("forgets an agent entirely, so a closed pane leaves no phantom hidden view", () => {
    setTerminalViewerVisible("a", PANE, false);
    noteOutputDropped("a");
    forgetTerminalViewers("a");
    expect(hasVisibleViewer("a")).toBe(true);
    expect(consumeMissedOutput("a")).toBe(false);
  });
});
