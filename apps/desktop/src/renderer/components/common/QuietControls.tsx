import { cn } from "@exegol/ui";
import { BellOff, Moon, Pause } from "lucide-react";
import { setAgentMuted, suspendAgent } from "../../lib/session-quiet";
import type { AgentState } from "../../stores/agents";

const chip = "flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10";

export type QuietAgent = Pick<AgentState, "id" | "cliType" | "status"> &
  Partial<Pick<AgentState, "alias" | "muted" | "suspended">>;

/** Mute / Suspend next to Watch in the terminal toolbar (live agent sessions) */
export function QuietControls({ agent, className }: { agent: QuietAgent; className?: string }) {
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAgentMuted(agent.id, !agent.muted).catch(() => {});
        }}
        className={cn(
          chip,
          agent.muted ? "text-sky-400" : "text-text-muted hover:text-text-primary",
          className,
        )}
        title={
          agent.muted
            ? "Muted: out of Needs attention, no notifications. Click to unmute"
            : "Mute: keep it running but out of Needs attention and notifications"
        }
      >
        {agent.muted ? <Moon className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
        {agent.muted ? "Muted" : "Mute"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          suspendAgent(agent.id).catch(() => {});
        }}
        className={cn(chip, "text-text-muted hover:text-text-primary", className)}
        title="Suspend: stop it quietly and keep it here to Resume later"
      >
        <Pause className="h-3 w-3" />
        Suspend
      </button>
    </>
  );
}

/** Small marker for lists (sidebar, Dashboard) */
export function QuietBadge({ agent }: { agent: Partial<Pick<AgentState, "muted" | "suspended">> }) {
  if (agent.suspended)
    return <Pause className="h-2.5 w-2.5 shrink-0 text-text-muted" aria-label="Suspended" />;
  if (agent.muted)
    return <Moon className="h-2.5 w-2.5 shrink-0 text-sky-400/80" aria-label="Muted" />;
  return null;
}
