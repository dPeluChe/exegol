import { describe, expect, it } from "vitest";
import {
  BAR_SLOTS,
  moveWidget,
  PLACEMENTS,
  type PlacedWidget,
  type Placement,
  placementOf,
  placementsFor,
  placeWidget,
  resolveWidgetLayout,
  STATUS_BAR_WIDGETS,
  updateWidget,
  WIDGET_SLOTS,
  widgetsIn,
} from "./status-bar-widgets";

describe("resolveWidgetLayout", () => {
  it("defaults: project and branch left, agents center, plan usage right", () => {
    const layout = resolveWidgetLayout([]);
    expect(layout).toHaveLength(STATUS_BAR_WIDGETS.length);
    expect(widgetsIn(layout, "footer", "left")).toEqual(["project", "branch"]);
    expect(widgetsIn(layout, "footer", "center")).toEqual(["agents"]);
    expect(widgetsIn(layout, "footer", "right")).toEqual(["plan-usage"]);
  });

  it("keeps the saved order and placement, drops unknown and repeated ids, appends new ones", () => {
    const layout = resolveWidgetLayout([
      { id: "clock", on: true, slot: "left" },
      { id: "gone-widget", on: true, slot: "left" },
      { id: "project", on: true, slot: "right" },
      { id: "clock", on: false, slot: "right" },
    ]);
    expect(layout.slice(0, 2)).toEqual([
      { id: "clock", on: true, bar: "footer", slot: "left" },
      { id: "project", on: true, bar: "footer", slot: "right" },
    ]);
    expect(layout).toHaveLength(STATUS_BAR_WIDGETS.length);
    expect(layout.find((w) => w.id === "branch")).toEqual({
      id: "branch",
      on: true,
      bar: "footer",
      slot: "left",
    });
    expect(widgetsIn(layout, "footer", "left")).toEqual(["clock", "branch"]);
  });

  it("an invalid slot falls back to the widget's default", () => {
    const saved = [{ id: "agents", on: true, slot: "top" as "left" }];
    expect(resolveWidgetLayout(saved)[0]).toEqual({
      id: "agents",
      on: true,
      bar: "footer",
      slot: "center",
    });
  });
});

describe("moveWidget", () => {
  it("swaps with the next widget in the same slot, skipping other slots", () => {
    const layout = resolveWidgetLayout([]);
    const tokensOn = updateWidget(layout, "tokens", { on: true });
    expect(widgetsIn(tokensOn, "footer", "right")).toEqual(["plan-usage", "tokens"]);
    expect(widgetsIn(moveWidget(tokensOn, "tokens", -1), "footer", "right")).toEqual([
      "tokens",
      "plan-usage",
    ]);
    const clockLeft = updateWidget(layout, "clock", { on: true, slot: "left" });
    expect(widgetsIn(moveWidget(clockLeft, "clock", -1), "footer", "left")).toEqual([
      "project",
      "clock",
      "branch",
    ]);
    const branchFirst = moveWidget(layout, "branch", -1);
    expect(widgetsIn(branchFirst, "footer", "left")).toEqual(["branch", "project"]);
  });

  it("does nothing at the end of a slot or for an unknown id", () => {
    const layout = resolveWidgetLayout([]);
    expect(moveWidget(layout, "project", -1)).toBe(layout);
    expect(moveWidget(layout, "nope", 1)).toBe(layout);
  });
});

describe("dictation widget default", () => {
  it("is off until the mic was allowed, then on in the right slot; a saved choice wins", () => {
    expect(widgetsIn(resolveWidgetLayout([]), "footer", "right")).not.toContain("dictation");
    expect(widgetsIn(resolveWidgetLayout([], { dictation: true }), "footer", "right")).toContain(
      "dictation",
    );
    const saved = [{ id: "dictation", on: false, slot: "right" as const }];
    expect(
      widgetsIn(resolveWidgetLayout(saved, { dictation: true }), "footer", "right"),
    ).not.toContain("dictation");
  });
});

describe("updateWidget", () => {
  it("moves a widget to another slot and toggles it", () => {
    const layout = updateWidget(resolveWidgetLayout([]), "clock", { on: true, slot: "center" });
    expect(widgetsIn(layout, "footer", "center")).toEqual(["agents", "clock"]);
  });
});

describe("title bar zones", () => {
  it("a layout saved before the title bar had zones stays in the footer, unchanged", () => {
    const saved = [
      { id: "clock", on: true, slot: "center" as const },
      { id: "project", on: true, slot: "right" as const },
      { id: "agents", on: false, slot: "center" as const },
    ];
    const layout = resolveWidgetLayout(saved);
    expect(layout.slice(0, 3).every((w) => w.bar === "footer")).toBe(true);
    expect(widgetsIn(layout, "footer", "center")).toEqual(["clock"]);
    expect(widgetsIn(layout, "footer", "right")).toEqual(["project", "plan-usage"]);
  });

  it("every title bar zone is empty by default", () => {
    const layout = resolveWidgetLayout([], { dictation: true });
    for (const slot of WIDGET_SLOTS) expect(widgetsIn(layout, "header", slot)).toEqual([]);
  });

  it("keeps a saved header placement and treats an unknown bar as the footer", () => {
    const layout = resolveWidgetLayout([
      { id: "clock", on: true, bar: "header", slot: "right" },
      { id: "tokens", on: true, bar: "side" as "header", slot: "right" },
    ]);
    expect(widgetsIn(layout, "header", "right")).toEqual(["clock"]);
    expect(widgetsIn(layout, "footer", "right")).toEqual(["tokens", "plan-usage"]);
  });
});

describe("placeWidget", () => {
  it("moves a widget to a header zone's end, so it shows in one place only", () => {
    let layout = placeWidget(resolveWidgetLayout([]), "clock", "header:left");
    layout = placeWidget(layout, "branch", "header:left");
    expect(widgetsIn(layout, "header", "left")).toEqual(["clock", "branch"]);
    expect(widgetsIn(layout, "footer", "left")).toEqual(["project"]);
    expect(layout.filter((w) => w.id === "branch")).toHaveLength(1);
    expect(placementOf(layout.find((w) => w.id === "branch") as PlacedWidget)).toBe("header:left");
  });

  it("hidden keeps the zone and order, and showing it there again restores its spot", () => {
    const layout = resolveWidgetLayout([]);
    const hidden = placeWidget(layout, "project", "hidden");
    expect(widgetsIn(hidden, "footer", "left")).toEqual(["branch"]);
    expect(placementOf(hidden[0] as PlacedWidget)).toBe("hidden");
    expect(widgetsIn(placeWidget(hidden, "project", "footer:left"), "footer", "left")).toEqual([
      "project",
      "branch",
    ]);
  });

  it("lists hidden and five zones: the title bar has no center", () => {
    expect(PLACEMENTS).toEqual([
      "hidden",
      "header:left",
      "header:right",
      "footer:left",
      "footer:center",
      "footer:right",
    ]);
    expect(BAR_SLOTS.header).not.toContain("center");
  });

  it("keeps the project widget out of the title bar", () => {
    expect(placementsFor("project").some((p) => p.startsWith("header:"))).toBe(false);
    expect(placementsFor("clock")).toEqual(PLACEMENTS);
    const layout = resolveWidgetLayout([]);
    expect(placeWidget(layout, "project", "header:left")).toBe(layout);
    expect(placeWidget(layout, "clock", "header:center" as Placement)).toBe(layout);
  });
});

describe("saved zones that are not offered", () => {
  it("header center lands in header right, the project widget in its footer slot", () => {
    const layout = resolveWidgetLayout([
      { id: "clock", on: true, bar: "header", slot: "center" },
      { id: "project", on: true, bar: "header", slot: "left" },
    ]);
    expect(widgetsIn(layout, "header", "right")).toEqual(["clock"]);
    expect(widgetsIn(layout, "header", "center")).toEqual([]);
    expect(widgetsIn(layout, "header", "left")).toEqual([]);
    expect(widgetsIn(layout, "footer", "left")).toEqual(["project", "branch"]);
  });
});

describe("zone ordering", () => {
  it("moves within its own zone only, skipping hidden widgets and other bars", () => {
    let layout = placeWidget(resolveWidgetLayout([]), "clock", "header:right");
    layout = placeWidget(layout, "tokens", "header:right");
    layout = placeWidget(layout, "resources", "footer:right");
    expect(widgetsIn(moveWidget(layout, "tokens", -1), "header", "right")).toEqual([
      "tokens",
      "clock",
    ]);
    expect(widgetsIn(moveWidget(layout, "resources", -1), "footer", "right")).toEqual([
      "resources",
      "plan-usage",
    ]);
    expect(moveWidget(layout, "clock", -1)).toBe(layout);
  });
});
