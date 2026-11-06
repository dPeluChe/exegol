import { cn } from "@exegol/ui";
import { Maximize2, Minimize2 } from "lucide-react";
import { DEFAULT_CARD_FONT, stepCardFont, useWatchStore } from "../../stores/watch";

/**
 * A-/A+ and "fit session to card": a plain mirror shows the owner pane's grid
 * shrunk to fit, which gets tiny side by side. Sizing the session to the card
 * reads at a normal font; the pane takes the size back when it is shown again.
 */
export function CardSizeControls({ agentId }: { agentId: string }) {
  const cardFont = useWatchStore((s) => s.cardFont[agentId]);
  const setCardFont = useWatchStore((s) => s.setCardFont);
  const sizing = cardFont !== undefined;
  const step = (delta: number) => stepCardFont(agentId, delta);
  const btn =
    "rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary";

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={() => step(-1)} className={btn} title="Smaller text">
        A−
      </button>
      {sizing && (
        <span className="w-5 text-center text-[10px] tabular-nums text-accent">{cardFont}</span>
      )}
      <button type="button" onClick={() => step(1)} className={btn} title="Larger text">
        A+
      </button>
      <button
        type="button"
        onClick={() => setCardFont(agentId, sizing ? null : DEFAULT_CARD_FONT)}
        className={cn(btn, sizing && "text-accent")}
        title={
          sizing
            ? "Stop sizing the session here: show the pane's layout, scaled to fit"
            : "Fit the session to this card: readable text, but it changes the session's width, and a CLI that redraws in place (Claude) can leave overlapped lines when you switch between the card and its pane"
        }
      >
        {sizing ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
      </button>
    </div>
  );
}
