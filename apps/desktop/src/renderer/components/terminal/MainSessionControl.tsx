import { cn } from "@exegol/ui";
import { Crown } from "lucide-react";
import { useMainSessions, useSetMainSession } from "../../hooks/use-main-sessions";

/** Marks the session as its project's main one, or clears that mark */
export function MainSessionControl({ agentId }: { agentId: string }) {
  const mains = useMainSessions();
  const setMain = useSetMainSession();
  const main = mains && Object.values(mains).find((m) => m.id === agentId);
  const title = !main
    ? "Make this the project's main session"
    : main.marked
      ? "The project's main session, marked by you. Click to clear the mark: the session opened first is main again"
      : "The project's main session: the one opened first. Click to keep it main whatever else is open";
  return (
    <button
      type="button"
      aria-pressed={!!main}
      onClick={(e) => {
        e.stopPropagation();
        void setMain(agentId, !main?.marked);
      }}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded px-1 py-0 text-[9px] hover:bg-white/10",
        main ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary",
      )}
      title={title}
    >
      <Crown className="h-3 w-3" />
      Main
    </button>
  );
}
