import type { Settings } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useWidgetDefaults } from "../../hooks/use-trpc-dictation";
import {
  BAR_SLOTS,
  moveWidget,
  type PlacedWidget,
  type Placement,
  placementOf,
  placementsFor,
  placeWidget,
  resolveWidgetLayout,
  STATUS_BAR_WIDGETS,
  updateWidget,
  WIDGET_BARS,
  WIDGET_SLOTS,
  type WidgetBar,
  type WidgetMode,
  type WidgetSlot,
  widgetsIn,
  zoneWidgets,
} from "../../lib/status-bar-widgets";

const LABEL = new Map<string, string>(STATUS_BAR_WIDGETS.map((w) => [w.id, w.label]));
const DESCRIPTION = new Map<string, string>(STATUS_BAR_WIDGETS.map((w) => [w.id, w.description]));
const BAR_LABEL: Record<WidgetBar, string> = { header: "Title bar", footer: "Status bar" };
const SLOT_LABEL: Record<WidgetSlot, string> = { left: "Left", center: "Center", right: "Right" };
const MODE_LABEL: Record<WidgetMode, string> = { percent: "Percent", values: "Values" };
const PLACEMENT_LABEL: Record<Placement, string> = {
  hidden: "Hidden",
  "header:left": "Title bar left",
  "header:center": "Title bar center",
  "header:right": "Title bar right",
  "footer:left": "Status bar left",
  "footer:center": "Status bar center",
  "footer:right": "Status bar right",
};

interface Props {
  settings: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

/** Which widgets the title bar and the footer show, in which zone and order. Saved as one setting */
export function StatusBarSettings({ settings, onChange }: Props) {
  const layout = resolveWidgetLayout(settings.statusBarWidgets, useWidgetDefaults());
  const save = (next: PlacedWidget[]) => onChange({ statusBarWidgets: next });
  const hidden = layout.filter((w) => !w.on);

  const rows = (list: PlacedWidget[], reorder: boolean) => (
    <div className="flex flex-col gap-1.5">
      {list.map((w, i) => (
        <WidgetRow
          key={w.id}
          widget={w}
          first={!reorder || i === 0}
          last={!reorder || i === list.length - 1}
          onPlace={(p) => save(placeWidget(layout, w.id, p))}
          onMode={
            w.id === "resources" ? (mode) => save(updateWidget(layout, w.id, { mode })) : undefined
          }
          onMove={(d) => save(moveWidget(layout, w.id, d))}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Preview
        </h3>
        <div className="space-y-1.5">
          {WIDGET_BARS.map((bar) => (
            <BarPreview key={bar} layout={layout} bar={bar} />
          ))}
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          A widget with nothing to show (no updates, no alerts) hides itself. The title bar keeps
          its own buttons and the project name in the center; its zones sit left and right.
        </p>
      </div>

      {WIDGET_BARS.map((bar) => (
        <div key={bar}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {BAR_LABEL[bar]}
          </h3>
          <div className="space-y-2">
            {BAR_SLOTS[bar].map((slot) => {
              const list = zoneWidgets(layout, bar, slot);
              if (list.length === 0) {
                return (
                  <p key={slot} className="text-[11px] text-text-muted">
                    {SLOT_LABEL[slot]}: empty
                  </p>
                );
              }
              return (
                <div key={slot}>
                  <p className="mb-1 text-[11px] text-text-secondary">{SLOT_LABEL[slot]}</p>
                  {rows(list, true)}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hidden.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Hidden
          </h3>
          {rows(hidden, false)}
        </div>
      )}
    </div>
  );
}

function BarPreview({ layout, bar }: { layout: PlacedWidget[]; bar: WidgetBar }) {
  return (
    <div className="flex h-7 items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 text-[10px] text-text-muted">
      <span className="w-16 shrink-0 text-[9px] uppercase tracking-wider">{BAR_LABEL[bar]}</span>
      {WIDGET_SLOTS.map((slot) => (
        <div
          key={slot}
          className={cn(
            "flex min-w-0 flex-1 gap-1.5 overflow-hidden",
            slot === "center" ? "justify-center" : slot === "right" ? "justify-end" : "",
          )}
        >
          {bar === "header" && slot === "center" && (
            <span className="shrink-0 px-1.5 py-0.5 text-text-secondary">Project</span>
          )}
          {widgetsIn(layout, bar, slot).map((id) => (
            <span key={id} className="shrink-0 rounded bg-white/5 px-1.5 py-0.5">
              {LABEL.get(id)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function WidgetRow({
  widget,
  first,
  last,
  onPlace,
  onMode,
  onMove,
}: {
  widget: PlacedWidget;
  first: boolean;
  last: boolean;
  onPlace: (to: Placement) => void;
  onMode?: (mode: WidgetMode) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const arrow =
    "rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary disabled:opacity-30";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2",
        widget.on ? "border-accent/40 bg-accent/5" : "border-border bg-bg-secondary",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium", widget.on ? "text-accent" : "text-text-secondary")}>
          {LABEL.get(widget.id)}
        </p>
        <p className="text-[10px] text-text-muted">{DESCRIPTION.get(widget.id)}</p>
      </div>
      {onMode && (
        <select
          value={widget.mode ?? "percent"}
          onChange={(e) => onMode(e.target.value as WidgetMode)}
          className="rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary"
          aria-label="Display"
          title="Percent: RAM 70%. Values: RAM 22.4/32 GB. CPU is always a percent"
        >
          {(Object.keys(MODE_LABEL) as WidgetMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      )}
      <select
        value={placementOf(widget)}
        onChange={(e) => onPlace(e.target.value as Placement)}
        className="rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary"
        aria-label="Placement"
      >
        {placementsFor(widget.id).map((p) => (
          <option key={p} value={p}>
            {PLACEMENT_LABEL[p]}
          </option>
        ))}
      </select>
      <div className="flex flex-col">
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(-1)}
          className={arrow}
          title="Move up"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(1)}
          className={arrow}
          title="Move down"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
