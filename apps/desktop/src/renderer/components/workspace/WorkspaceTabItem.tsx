import { cn } from "@exegol/ui";
import { Globe, X } from "lucide-react";
import { type Dispatch, type DragEvent, memo, type Ref, type SetStateAction } from "react";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import type { WorkspaceTab } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

interface WorkspaceTabItemProps {
  tab: WorkspaceTab;
  isActive: boolean;
  isEditing: boolean;
  displayName: string;
  TabIcon: React.ComponentType<{ className?: string }> | null;
  /** An agent tab: that CLI's icon instead of the generic one */
  agentCliType: string | null;
  /** Shown muted past one pane, the layout has no name of its own */
  paneCount: number;
  /** A session here waits on you: the badge replaces the dot */
  needsYou: boolean;
  dotClass: string | null;
  /** An agent is driving a browser pane in this tab */
  agentBrowsing?: boolean;
  dragOverTabId: string | null;
  editValue: string;
  setEditValue: Dispatch<SetStateAction<string>>;
  setEditingTabId: Dispatch<SetStateAction<string | null>>;
  inputRef: Ref<HTMLInputElement>;
  finishEditing: () => void;
  startEditing: (tabId: string, currentLabel: string) => void;
  setActiveTab: (id: string) => void;
  handleCloseTab: (id: string) => void;
  handleTabDragStart: (e: DragEvent, tabId: string) => void;
  handleTabDragOver: (e: DragEvent, tabId: string) => void;
  handleTabDragLeave: () => void;
  handleTabDrop: (e: DragEvent, tabId: string) => void;
  handleTabDragEnd: () => void;
}

// Memo: agent pushes re-render the bar, and most change nothing on a given tab
export const WorkspaceTabItem = memo(function WorkspaceTabItem({
  tab,
  isActive,
  isEditing,
  displayName,
  TabIcon,
  agentCliType,
  paneCount,
  needsYou,
  dotClass,
  agentBrowsing = false,
  dragOverTabId,
  editValue,
  setEditValue,
  setEditingTabId,
  inputRef,
  finishEditing,
  startEditing,
  setActiveTab,
  handleCloseTab,
  handleTabDragStart,
  handleTabDragOver,
  handleTabDragLeave,
  handleTabDrop,
  handleTabDragEnd,
}: WorkspaceTabItemProps) {
  // Every control is a drop target so the whole tab accepts a reorder drop, as the old wrapper did.
  const dropTarget = {
    onDragOver: (e: DragEvent) => handleTabDragOver(e, tab.id),
    onDragLeave: handleTabDragLeave,
    onDrop: (e: DragEvent) => handleTabDrop(e, tab.id),
  };

  return (
    <div
      className={cn(
        "group relative flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors",
        "hover:bg-white/5 cursor-pointer",
        isActive ? "bg-white/10 text-text-primary" : "text-text-secondary",
        dragOverTabId === tab.id && "ring-1 ring-accent/50",
      )}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEditing}
          {...dropTarget}
          onKeyDown={(e) => {
            if (e.key === "Enter") finishEditing();
            if (e.key === "Escape") setEditingTabId(null);
            e.stopPropagation();
          }}
          className="w-24 bg-transparent text-xs text-text-primary outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => startEditing(tab.id, tab.label)}
          draggable
          onDragStart={(e) => handleTabDragStart(e, tab.id)}
          onDragEnd={handleTabDragEnd}
          {...dropTarget}
          className="-mr-1.5 -ml-2.5 flex cursor-pointer items-center gap-1.5 self-stretch pr-1.5 pl-2.5"
        >
          {agentCliType ? (
            <AgentIcon provider={agentCliType} size={14} />
          ) : (
            TabIcon && <TabIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          )}
          <span className="max-w-[160px] truncate">{displayName}</span>
          {paneCount > 1 && (
            <span className="text-[10px] text-text-muted" title={`${paneCount} panes`}>
              {paneCount}
            </span>
          )}
          {agentBrowsing && (
            <Globe
              className="h-2.5 w-2.5 shrink-0 animate-pulse text-accent"
              aria-label="An agent is using a browser here"
            />
          )}
          {needsYou ? (
            <span
              className={cn(SEMANTIC_BADGE.warning, "shrink-0 rounded px-1 text-[10px] leading-4")}
            >
              Needs you
            </span>
          ) : (
            dotClass && (
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)}
                aria-hidden="true"
              />
            )
          )}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleCloseTab(tab.id);
        }}
        {...dropTarget}
        className={cn(
          "ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded",
          "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          "hover:bg-white/10",
        )}
        title="Close tab"
        aria-label="Close tab"
      >
        <X className="h-2.5 w-2.5" />
      </button>
      {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />}
    </div>
  );
});
