import { cn } from "@exegol/ui";
import { AlertCircle, AlertTriangle, Bell, CheckCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import {
  type AttentionItem,
  type AttentionLevel,
  jumpToAttentionItem,
  sortAttentionItems,
  useAgentStore,
} from "../../stores/agents";
import { AgentIcon } from "../common/AgentIcon";

const LEVEL_ICON: Record<AttentionLevel, typeof AlertCircle> = {
  critical: AlertCircle,
  action_needed: AlertTriangle,
  info: CheckCircle,
};

const LEVEL_DOT: Record<AttentionLevel, string> = {
  critical: "bg-red-500",
  action_needed: "bg-amber-500",
  info: "bg-blue-400",
};

/**
 * Global "needs attention" queue (T141) — a TitleBar dropdown mirroring the
 * sidebar's per-project AttentionSection, but flattened across all projects
 * so a click always jumps straight to the pane regardless of what's active.
 */
export function AttentionQueue() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rawItems = useAgentStore((s) => s.attentionItems);
  const unreadCount = useAgentStore((s) => s.unreadAttentionCount);
  const items = sortAttentionItems(Object.values(rawItems));

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={menuRef} className="titlebar-no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors hover:bg-white/10",
          unreadCount > 0 ? "text-amber-400" : "text-text-secondary",
        )}
        title="Agents needing attention (Cmd+J to jump to next)"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && <span className="font-medium">{unreadCount}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-bg-secondary py-1 shadow-lg">
          <div className="max-h-80 overflow-y-auto">
            {items.map((item) => (
              <AttentionQueueRow key={item.agentId} item={item} onClose={() => setOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AttentionQueueRow({ item, onClose }: { item: AttentionItem; onClose: () => void }) {
  const { data: project } = useProject(item.projectId);
  const LevelIcon = LEVEL_ICON[item.level];

  return (
    <button
      type="button"
      onClick={() => {
        jumpToAttentionItem(item.agentId, item.projectId);
        onClose();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
        item.read && "opacity-60",
      )}
    >
      <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[item.level])} />
      <AgentIcon provider={item.cliType} size={13} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate text-text-primary">
          <span className="font-medium">{project?.name ?? item.projectId.slice(0, 10)}</span>
          <LevelIcon className="h-2.5 w-2.5 shrink-0 text-text-muted" />
          <span className="truncate text-text-muted">{item.reason}</span>
        </div>
      </div>
    </button>
  );
}
