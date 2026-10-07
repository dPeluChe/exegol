import type { StatusBarWidgetSetting } from "@exegol/shared";

export type WidgetSlot = StatusBarWidgetSetting["slot"];

export const WIDGET_SLOTS: WidgetSlot[] = ["left", "center", "right"];

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
  slot: WidgetSlot;
  mode?: WidgetMode;
}

const KNOWN = new Map(STATUS_BAR_WIDGETS.map((w) => [w.id as string, w]));

/** Every widget once, in the saved order: unknown or repeated ids dropped, new ones appended at
 *  their defaults */
export function resolveWidgetLayout(saved: readonly StatusBarWidgetSetting[] = []): PlacedWidget[] {
  const out: PlacedWidget[] = [];
  const seen = new Set<string>();
  for (const s of saved) {
    const def = KNOWN.get(s.id);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    const slot = WIDGET_SLOTS.includes(s.slot) ? s.slot : def.defaultSlot;
    out.push(
      s.mode ? { id: def.id, on: s.on, slot, mode: s.mode } : { id: def.id, on: s.on, slot },
    );
  }
  for (const def of STATUS_BAR_WIDGETS) {
    if (!seen.has(def.id)) out.push({ id: def.id, on: def.defaultOn, slot: def.defaultSlot });
  }
  return out;
}

export const widgetMode = (layout: PlacedWidget[], id: StatusBarWidgetId): WidgetMode =>
  layout.find((w) => w.id === id)?.mode ?? "percent";

/** The widgets shown in one slot, in order */
export const widgetsIn = (layout: PlacedWidget[], slot: WidgetSlot): StatusBarWidgetId[] =>
  layout.filter((w) => w.on && w.slot === slot).map((w) => w.id);

/** Move a widget up (-1) or down (+1) past the next widget in its own slot */
export function moveWidget(layout: PlacedWidget[], id: string, delta: -1 | 1): PlacedWidget[] {
  const from = layout.findIndex((w) => w.id === id);
  const moving = layout[from];
  if (!moving) return layout;
  let to = from + delta;
  while (layout[to] && layout[to]?.slot !== moving.slot) to += delta;
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
