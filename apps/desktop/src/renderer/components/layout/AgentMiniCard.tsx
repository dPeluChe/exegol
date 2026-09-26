import { cn } from "@exegol/ui";
import { BellOff, Moon, Pause, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeleteAgent } from "../../hooks/use-delete-agent";
import { formatTimeAgo } from "../../lib/format";
import { STATUS_DOT_COLORS } from "../../lib/semantic-colors";
import { setAgentMuted, suspendAgent } from "../../lib/session-quiet";
import { type AgentState, jumpToAgent, useAgentStore } from "../../stores/agents";
import { AgentCliIcon } from "../common/AgentCliIcon";
import { QuietBadge } from "../common/QuietControls";

export const VISIBLE_STATUSES = new Set([
  "running",
  "spawning",
  "waiting_input",
  "paused",
  "completed",
  "failed",
  "stopped",
  "crashed",
]);

export function AgentMiniCard({ agent }: { agent: AgentState }) {
  const isFocused = useAgentStore((s) => s.focusedAgentId === agent.id);
  const isUnread = useAgentStore((s) => {
    const item = s.attentionItems[agent.id];
    return !!item && !item.read;
  });
  const deleteAgent = useDeleteAgent();
  const isActive = ["running", "spawning", "waiting_input"].includes(agent.status);
  const isCrashed = agent.status === "crashed";

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu, closeContextMenu]);

  const handleRemove = useCallback(async () => {
    closeContextMenu();
    try {
      await deleteAgent(agent.id);
    } catch (err) {
      console.error("[AgentMiniCard] Failed to delete agent:", err);
    }
  }, [agent.id, deleteAgent, closeContextMenu]);

  // The alias is the session's name; a quick launch's task is only the CLI's name
  const displayName =
    agent.alias ??
    (agent.taskDescription && agent.taskDescription !== agent.cliType
      ? agent.taskDescription.slice(0, 40)
      : agent.cliType);

  // Its own pane, or a new tab: never over whatever the active tab shows
  const handleNavigate = () => jumpToAgent(agent.id, agent.projectId);

  return (
    <div
      role="none"
      className={cn(
        "relative flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
        isFocused
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
      onContextMenu={handleContextMenu}
    >
      <button
        type="button"
        onClick={handleNavigate}
        className="flex flex-1 items-center gap-2 text-left"
      >
        {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        <AgentCliIcon agent={agent} size={16} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_DOT_COLORS[agent.status] ?? "bg-zinc-500",
                agent.activityLevel === "busy" && "animate-status-pulse",
                agent.activityLevel === "idle" && isActive && "opacity-60",
              )}
            />
            <span className="flex-1 truncate text-[10px] font-medium">{displayName}</span>
            <QuietBadge agent={agent} />
            {agent.tokenUsage.cost > 0 && (
              <span className="shrink-0 text-[8px] tabular-nums text-accent">
                $
                {agent.tokenUsage.cost < 0.01
                  ? agent.tokenUsage.cost.toFixed(4)
                  : agent.tokenUsage.cost.toFixed(2)}
              </span>
            )}
            <span className="shrink-0 text-[8px] tabular-nums text-text-muted">
              {formatTimeAgo(agent.startedAt)}
            </span>
          </div>
          {(agent.currentStep || isCrashed) && (
            <p
              className={cn(
                "truncate pl-2.5 text-[9px]",
                isCrashed ? "text-red-400" : "text-text-muted",
              )}
            >
              {isCrashed ? "Crashed — open it to resume" : agent.currentStep}
            </p>
          )}
        </div>
      </button>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-bg-secondary py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {isActive && agent.cliType !== "shell" && (
            <>
              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  setAgentMuted(agent.id, !agent.muted).catch(() => {});
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
              >
                {agent.muted ? <Moon className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                {agent.muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  suspendAgent(agent.id).catch(() => {});
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
              >
                <Pause className="h-3 w-3" />
                Suspend
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleRemove}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 transition-colors hover:bg-white/10"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
