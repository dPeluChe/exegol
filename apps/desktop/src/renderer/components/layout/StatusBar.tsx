import { Settings2 } from "lucide-react";
import { BAR_SLOTS } from "../../lib/status-bar-widgets";
import { useWidgetLayout, WidgetZone } from "./bar-widgets";

/** The footer zones picked in Settings > Bars, in their slot and order */
export function StatusBar() {
  const layout = useWidgetLayout();

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg-secondary pl-3 pr-1 text-[11px] text-text-muted">
      {BAR_SLOTS.footer.map((slot) => (
        <WidgetZone key={slot} layout={layout} bar="footer" slot={slot} />
      ))}
      <button
        type="button"
        onClick={() => window.api.settings.open("statusbar")}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10 hover:text-text-primary"
        title="Choose what the status bar and the title bar show"
      >
        <Settings2 className="h-3 w-3" />
      </button>
    </div>
  );
}
