import { cn } from "@exegol/ui";
import { useNow } from "../../../hooks/use-now";
import type { DeskState } from "../../../lib/company";
import { formatTimeAgo } from "../../../lib/format";

export const DESK_STATE: Record<DeskState, { label: string; color: string; ring: string }> = {
  needs: {
    label: "needs you",
    color: "text-amber-400",
    ring: "border-amber-400/60 motion-safe:animate-pulse",
  },
  stuck: { label: "stuck", color: "text-error", ring: "border-error/60" },
  unread: { label: "unread", color: "text-accent", ring: "border-accent/50" },
  working: { label: "working", color: "text-green-400", ring: "border-green-500/40" },
  idle: { label: "waiting", color: "text-text-muted", ring: "border-border" },
  suspended: { label: "suspended", color: "text-text-muted", ring: "border-border opacity-60" },
};

/** Leaf timer: only this line re-renders as time passes */
export function StateLine({ state, activitySince }: { state: DeskState; activitySince?: number }) {
  useNow();
  const ago = activitySince && state !== "suspended" ? formatTimeAgo(activitySince / 1000) : "";
  return (
    <span className={cn("text-[10px]", DESK_STATE[state].color)}>
      {DESK_STATE[state].label}
      {ago && ago !== "now" ? ` ${ago}` : ""}
    </span>
  );
}
