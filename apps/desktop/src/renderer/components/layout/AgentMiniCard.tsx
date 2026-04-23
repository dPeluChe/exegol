import { cn } from "@exegol/ui";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeleteAgent } from "../../hooks/use-delete-agent";
import { formatTimeAgo } from "../../lib/format";
import { STATUS_DOT_COLORS } from "../../lib/semantic-colors";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { findFirstPaneId, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

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

export function navigateToAgent(agentId: string): void {
  window.dispatchEvent(new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }));
  const store = useWorkspaceStore.getState();
  const activeTab = store.getActiveTab();
  if (activeTab) {
    const paneId = findFirstPaneId(activeTab.layout);
    if (paneId) store.updatePane(paneId, { type: "terminal", agentId });
  }
  useAgentStore.getState().setFocusedAgent(agentId);
}

export function AgentMiniCard({ agent }: { agent: AgentState }) {
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
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

  const displayName =
    agent.taskDescription && agent.taskDescription !== agent.cliType
      ? agent.taskDescription.slice(0, 40)
      : agent.cliType;

  const handleNavigate = () => {
    setFocusedAgent(agent.id);
    navigateToAgent(agent.id);
  };

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
        <AgentIcon provider={agent.cliType} size={16} />

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
              {isCrashed ? "Crashed — click to re-launch" : agent.currentStep}
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
