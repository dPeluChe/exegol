import type { Settings } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useWidgetDefaults } from "../../hooks/use-trpc-dictation";
import {
  moveWidget,
  type PlacedWidget,
  resolveWidgetLayout,
  STATUS_BAR_WIDGETS,
  updateWidget,
  WIDGET_SLOTS,
  type WidgetMode,
  type WidgetSlot,
  widgetsIn,
} from "../../lib/status-bar-widgets";

const LABEL = new Map<string, string>(STATUS_BAR_WIDGETS.map((w) => [w.id, w.label]));
const DESCRIPTION = new Map<string, string>(STATUS_BAR_WIDGETS.map((w) => [w.id, w.description]));
const SLOT_LABEL: Record<WidgetSlot, string> = { left: "Left", center: "Center", right: "Right" };
const MODE_LABEL: Record<WidgetMode, string> = { percent: "Percent", values: "Values" };

interface Props {
  settings: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

/** Which widgets the footer shows, in which slot and order. Saved as one setting */
export function StatusBarSettings({ settings, onChange }: Props) {
  const layout = resolveWidgetLayout(settings.statusBarWidgets, useWidgetDefaults());
  const save = (next: PlacedWidget[]) => onChange({ statusBarWidgets: next });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Preview
        </h3>
        <div className="flex h-7 items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 text-[10px] text-text-muted">
          {WIDGET_SLOTS.map((slot) => (
            <div
              key={slot}
              className={cn(
                "flex min-w-0 flex-1 gap-1.5 overflow-hidden",
                slot === "center" ? "justify-center" : slot === "right" ? "justify-end" : "",
              )}
            >
              {widgetsIn(layout, slot).map((id) => (
                <span key={id} className="shrink-0 rounded bg-white/5 px-1.5 py-0.5">
                  {LABEL.get(id)}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          A widget with nothing to show (no updates, no alerts) hides itself.
        </p>
      </div>

      {WIDGET_SLOTS.map((slot) => {
        const rows = layout.filter((w) => w.slot === slot);
        return (
          <div key={slot}>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {SLOT_LABEL[slot]}
            </h3>
            {rows.length === 0 ? (
              <p className="text-[11px] text-text-muted">Empty</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {rows.map((w, i) => (
                  <WidgetRow
                    key={w.id}
                    widget={w}
                    first={i === 0}
                    last={i === rows.length - 1}
                    onToggle={() => save(updateWidget(layout, w.id, { on: !w.on }))}
                    onSlot={(s) => save(updateWidget(layout, w.id, { slot: s }))}
                    onMode={
                      w.id === "resources"
                        ? (mode) => save(updateWidget(layout, w.id, { mode }))
                        : undefined
                    }
                    onMove={(d) => save(moveWidget(layout, w.id, d))}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WidgetRow({
  widget,
  first,
  last,
  onToggle,
  onSlot,
  onMode,
  onMove,
}: {
  widget: PlacedWidget;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onSlot: (slot: WidgetSlot) => void;
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
      <button
        type="button"
        role="switch"
        aria-checked={widget.on}
        onClick={onToggle}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors",
          widget.on ? "bg-accent" : "bg-border",
        )}
        title={widget.on ? "Hide" : "Show"}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-white shadow transition-transform",
            widget.on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
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
        value={widget.slot}
        onChange={(e) => onSlot(e.target.value as WidgetSlot)}
        className="rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary"
        aria-label="Slot"
      >
        {WIDGET_SLOTS.map((s) => (
          <option key={s} value={s}>
            {SLOT_LABEL[s]}
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
