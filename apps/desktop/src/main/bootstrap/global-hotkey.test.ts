import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, globalShortcut: {} }));

const { isWaylandSession, withFeature } = await import("./global-hotkey");

describe("withFeature", () => {
  it("adds the feature to what was there, once", () => {
    expect(withFeature("", "GlobalShortcutsPortal")).toBe("GlobalShortcutsPortal");
    expect(withFeature("A,B", "GlobalShortcutsPortal")).toBe("A,B,GlobalShortcutsPortal");
    expect(withFeature("GlobalShortcutsPortal,A", "GlobalShortcutsPortal")).toBe(
      "GlobalShortcutsPortal,A",
    );
  });
});

describe("isWaylandSession", () => {
  it("from the session type or a Wayland display", () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" })).toBe(true);
    expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isWaylandSession({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" })).toBe(false);
  });
});
