import { cn } from "@exegol/ui";
import { Pin } from "lucide-react";
import { useWatchStore } from "../../stores/watch";

/** T194: pin a session to the Overview watch list (or unpin it). */
export function WatchToggle({ agentId, className }: { agentId: string; className?: string }) {
  const watching = useWatchStore((s) => s.watched.includes(agentId));
  const toggleWatch = useWatchStore((s) => s.toggleWatch);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleWatch(agentId);
      }}
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10",
        watching ? "text-accent" : "text-text-muted hover:text-text-primary",
        className,
      )}
      title={
        watching ? "Stop watching in Overview" : "Watch in Overview: work on it from any project"
      }
    >
      <Pin className="h-3 w-3" />
      {watching ? "Watching" : "Watch"}
    </button>
  );
}
