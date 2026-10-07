import { describe, expect, it } from "vitest";
import {
  moveWidget,
  resolveWidgetLayout,
  STATUS_BAR_WIDGETS,
  updateWidget,
  widgetsIn,
} from "./status-bar-widgets";

describe("resolveWidgetLayout", () => {
  it("defaults: project and branch left, agents center, plan usage right", () => {
    const layout = resolveWidgetLayout([]);
    expect(layout).toHaveLength(STATUS_BAR_WIDGETS.length);
    expect(widgetsIn(layout, "left")).toEqual(["project", "branch"]);
    expect(widgetsIn(layout, "center")).toEqual(["agents"]);
    expect(widgetsIn(layout, "right")).toEqual(["plan-usage"]);
  });

  it("keeps the saved order and placement, drops unknown and repeated ids, appends new ones", () => {
    const layout = resolveWidgetLayout([
      { id: "clock", on: true, slot: "left" },
      { id: "gone-widget", on: true, slot: "left" },
      { id: "project", on: true, slot: "right" },
      { id: "clock", on: false, slot: "right" },
    ]);
    expect(layout.slice(0, 2)).toEqual([
      { id: "clock", on: true, slot: "left" },
      { id: "project", on: true, slot: "right" },
    ]);
    expect(layout).toHaveLength(STATUS_BAR_WIDGETS.length);
    expect(layout.find((w) => w.id === "branch")).toEqual({ id: "branch", on: true, slot: "left" });
    expect(widgetsIn(layout, "left")).toEqual(["clock", "branch"]);
  });

  it("an invalid slot falls back to the widget's default", () => {
    const saved = [{ id: "agents", on: true, slot: "top" as "left" }];
    expect(resolveWidgetLayout(saved)[0]).toEqual({ id: "agents", on: true, slot: "center" });
  });
});

describe("moveWidget", () => {
  it("swaps with the next widget in the same slot, skipping other slots", () => {
    const layout = resolveWidgetLayout([]);
    const tokensOn = updateWidget(layout, "tokens", { on: true });
    expect(widgetsIn(tokensOn, "right")).toEqual(["plan-usage", "tokens"]);
    expect(widgetsIn(moveWidget(tokensOn, "tokens", -1), "right")).toEqual([
      "tokens",
      "plan-usage",
    ]);
    const clockLeft = updateWidget(layout, "clock", { on: true, slot: "left" });
    expect(widgetsIn(moveWidget(clockLeft, "clock", -1), "left")).toEqual([
      "project",
      "clock",
      "branch",
    ]);
    const branchFirst = moveWidget(layout, "branch", -1);
    expect(widgetsIn(branchFirst, "left")).toEqual(["branch", "project"]);
  });

  it("does nothing at the end of a slot or for an unknown id", () => {
    const layout = resolveWidgetLayout([]);
    expect(moveWidget(layout, "project", -1)).toBe(layout);
    expect(moveWidget(layout, "nope", 1)).toBe(layout);
  });
});

describe("dictation widget default", () => {
  it("is off until the mic was allowed, then on in the right slot; a saved choice wins", () => {
    expect(widgetsIn(resolveWidgetLayout([]), "right")).not.toContain("dictation");
    expect(widgetsIn(resolveWidgetLayout([], { dictation: true }), "right")).toContain("dictation");
    const saved = [{ id: "dictation", on: false, slot: "right" as const }];
    expect(widgetsIn(resolveWidgetLayout(saved, { dictation: true }), "right")).not.toContain(
      "dictation",
    );
  });
});

describe("updateWidget", () => {
  it("moves a widget to another slot and toggles it", () => {
    const layout = updateWidget(resolveWidgetLayout([]), "clock", { on: true, slot: "center" });
    expect(widgetsIn(layout, "center")).toEqual(["agents", "clock"]);
  });
});
