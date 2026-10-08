import type { StatusBarWidgetSetting } from "@exegol/shared";

export type WidgetSlot = StatusBarWidgetSetting["slot"];
export type WidgetBar = NonNullable<StatusBarWidgetSetting["bar"]>;

export const WIDGET_SLOTS: WidgetSlot[] = ["left", "center", "right"];
export const WIDGET_BARS: WidgetBar[] = ["header", "footer"];

export const STATUS_BAR_WIDGETS = [
  {
    id: "project",
    label: "Active project",
    description: "The project on screen, with its color",
    defaultOn: true,
    defaultSlot: "left",
  },
  {
    id: "branch",
    label: "Branch",
    description: "The focused session's worktree branch, else the project's current branch",
    defaultOn: true,
    defaultSlot: "left",
  },
  {
    id: "agents",
    label: "Agents",
    description: "How many sessions need you, are working or wait. Click for the list",
    defaultOn: true,
    defaultSlot: "center",
  },
  {
    id: "plan-usage",
    label: "Plan usage",
    description: "Each CLI's 5-hour and weekly use, and time to reset",
    defaultOn: true,
    defaultSlot: "right",
  },
  {
    id: "tokens",
    label: "Tokens today",
    description: "Tokens and estimated cost since midnight, all projects",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "resources",
    label: "Resources",
    description: "CPU and RAM use of the whole machine, not only Exegol",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "cli-updates",
    label: "CLI updates",
    description: "How many CLIs in use have a newer version",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "clock",
    label: "Clock",
    description: "The time (HH:MM)",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "attention",
    label: "Unread alerts",
    description: "How many attention items you have not read",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "focused-agent",
    label: "Focused session",
    description: "The focused session's model, access mode, YOLO and worktree",
    defaultOn: false,
    defaultSlot: "left",
  },
  {
    id: "git-state",
    label: "Git state",
    description: "Dirty files, ahead/behind and PR of the focused folder, from the Git pane's data",
    defaultOn: false,
    defaultSlot: "left",
  },
  {
    id: "reconnect",
    label: "Reconnecting",
    description: "Sessions still reconnecting after a start; hides when done",
    defaultOn: false,
    defaultSlot: "center",
  },
  {
    id: "mcp",
    label: "Exegol tools (MCP)",
    description:
      "How many live agents have the Exegol tools (memory, messaging, browser) connected",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "dictation",
    label: "Dictation",
    description:
      "A mic button: dictate into the focused pane. On by default once the microphone was allowed",
    defaultOn: false,
    defaultSlot: "right",
  },
  {
    id: "app-update",
    label: "Exegol update",
    description: "A new Exegol version is downloading or ready",
    defaultOn: false,
    defaultSlot: "right",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  defaultSlot: WidgetSlot;
}[];

export type StatusBarWidgetId = (typeof STATUS_BAR_WIDGETS)[number]["id"];

export type WidgetMode = NonNullable<StatusBarWidgetSetting["mode"]>;

export interface PlacedWidget {
  id: StatusBarWidgetId;
  on: boolean;
  bar: WidgetBar;
  slot: WidgetSlot;
  mode?: WidgetMode;
}

const KNOWN = new Map(STATUS_BAR_WIDGETS.map((w) => [w.id as string, w]));

/** The title bar has no center zone: the project name and the dictation dock own it */
export const BAR_SLOTS: Record<WidgetBar, WidgetSlot[]> = {
  header: ["left", "right"],
  footer: WIDGET_SLOTS,
};

/** Widgets the title bar never takes: the project one repeats its name */
const FOOTER_ONLY = new Set<string>(["project"]);

/** A saved entry in a zone that does not exist (or no longer may hold it) lands somewhere valid:
 *  header center to header right, a footer-only widget in the header to the footer */
function validZone(id: string, bar: WidgetBar, slot: WidgetSlot): [WidgetBar, WidgetSlot] {
  if (bar === "header" && FOOTER_ONLY.has(id)) return ["footer", slot];
  if (!BAR_SLOTS[bar].includes(slot)) return [bar, "right"];
  return [bar, slot];
}

/** Every widget once, in the saved order: unknown or repeated ids dropped, new ones appended at
 *  their defaults (`defaultOn` overrides a default that depends on state, like Dictation's).
 *  Every default is in the footer, so the title bar's zones start empty */
export function resolveWidgetLayout(
  saved: readonly StatusBarWidgetSetting[] = [],
  defaultOn: Partial<Record<StatusBarWidgetId, boolean>> = {},
): PlacedWidget[] {
  const out: PlacedWidget[] = [];
  const seen = new Set<string>();
  for (const s of saved) {
    const def = KNOWN.get(s.id);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    const [bar, slot] = validZone(
      def.id,
      s.bar === "header" ? "header" : "footer",
      WIDGET_SLOTS.includes(s.slot) ? s.slot : def.defaultSlot,
    );
    const placed: PlacedWidget = { id: def.id, on: s.on, bar, slot };
    out.push(s.mode ? { ...placed, mode: s.mode } : placed);
  }
  for (const def of STATUS_BAR_WIDGETS) {
    if (!seen.has(def.id)) {
      out.push({
        id: def.id,
        on: defaultOn[def.id] ?? def.defaultOn,
        bar: "footer",
        slot: def.defaultSlot,
      });
    }
  }
  return out;
}

export const widgetMode = (layout: PlacedWidget[], id: StatusBarWidgetId): WidgetMode =>
  layout.find((w) => w.id === id)?.mode ?? "percent";

const inZone = (w: PlacedWidget, bar: WidgetBar, slot: WidgetSlot) =>
  w.on && w.bar === bar && w.slot === slot;

/** The widgets shown in one zone, in order */
export const zoneWidgets = (
  layout: PlacedWidget[],
  bar: WidgetBar,
  slot: WidgetSlot,
): PlacedWidget[] => layout.filter((w) => inZone(w, bar, slot));

export const widgetsIn = (
  layout: PlacedWidget[],
  bar: WidgetBar,
  slot: WidgetSlot,
): StatusBarWidgetId[] => zoneWidgets(layout, bar, slot).map((w) => w.id);

/** Move a widget up (-1) or down (+1) past the next shown widget in its own zone */
export function moveWidget(layout: PlacedWidget[], id: string, delta: -1 | 1): PlacedWidget[] {
  const from = layout.findIndex((w) => w.id === id);
  const moving = layout[from];
  if (!moving) return layout;
  let to = from + delta;
  while (layout[to] && !inZone(layout[to] as PlacedWidget, moving.bar, moving.slot)) to += delta;
  const other = layout[to];
  if (!other) return layout;
  const next = [...layout];
  next[from] = other;
  next[to] = moving;
  return next;
}

export function updateWidget(
  layout: PlacedWidget[],
  id: string,
  patch: Partial<Omit<PlacedWidget, "id">>,
): PlacedWidget[] {
  return layout.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

/** One choice of the Settings select: hidden, or a bar and a slot */
export type Placement = "hidden" | `${WidgetBar}:${WidgetSlot}`;

export const PLACEMENTS: Placement[] = [
  "hidden",
  ...WIDGET_BARS.flatMap((bar) => BAR_SLOTS[bar].map((slot) => `${bar}:${slot}` as const)),
];

/** The choices one widget offers: the project widget stays out of the title bar */
export const placementsFor = (id: string): Placement[] =>
  FOOTER_ONLY.has(id) ? PLACEMENTS.filter((p) => !p.startsWith("header:")) : PLACEMENTS;

export const placementOf = (w: PlacedWidget): Placement => (w.on ? `${w.bar}:${w.slot}` : "hidden");

/** Hiding keeps the zone, so showing it there again restores its spot; a move to another zone
 *  lands at that zone's end, so the widget is in one place only. A zone it may not take: no-op */
export function placeWidget(layout: PlacedWidget[], id: string, to: Placement): PlacedWidget[] {
  const w = layout.find((x) => x.id === id);
  if (!w || !placementsFor(id).includes(to)) return layout;
  if (to === "hidden") return updateWidget(layout, id, { on: false });
  const [bar, slot] = to.split(":") as [WidgetBar, WidgetSlot];
  if (w.bar === bar && w.slot === slot) return updateWidget(layout, id, { on: true });
  return [...layout.filter((x) => x.id !== id), { ...w, on: true, bar, slot }];
}
