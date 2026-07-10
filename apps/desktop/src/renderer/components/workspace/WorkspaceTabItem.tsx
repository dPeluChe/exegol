import type { AgentActivityLevel } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { X } from "lucide-react";
import type { Dispatch, DragEvent, Ref, SetStateAction } from "react";
import type { WorkspaceTab } from "../../stores/workspace";
import { ACTIVITY_DOT_CLASS } from "./tab-bar-helpers";

interface WorkspaceTabItemProps {
  tab: WorkspaceTab;
  isActive: boolean;
  isEditing: boolean;
  displayName: string;
  TabIcon: React.ComponentType<{ className?: string }> | null;
  tabActivity: AgentActivityLevel | undefined;
  /** T155.3: the tab's agent has an unread attention item — amber pulse wins */
  tabAttention?: boolean;
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

export function WorkspaceTabItem({
  tab,
  isActive,
  isEditing,
  displayName,
  TabIcon,
  tabActivity,
  tabAttention = false,
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
  return (
    // biome-ignore lint/a11y/useSemanticElements: contains close button — can't nest buttons
    <div
      role="button"
      tabIndex={0}
      draggable={!isEditing}
      onDragStart={(e) => handleTabDragStart(e, tab.id)}
      onDragOver={(e) => handleTabDragOver(e, tab.id)}
      onDragLeave={handleTabDragLeave}
      onDrop={(e) => handleTabDrop(e, tab.id)}
      onDragEnd={handleTabDragEnd}
      onClick={() => setActiveTab(tab.id)}
      onDoubleClick={() => startEditing(tab.id, tab.label)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setActiveTab(tab.id);
      }}
      className={cn(
        "group relative flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
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
          onKeyDown={(e) => {
            if (e.key === "Enter") finishEditing();
            if (e.key === "Escape") setEditingTabId(null);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-24 bg-transparent text-[11px] text-text-primary outline-none"
        />
      ) : (
        <>
          {TabIcon && <TabIcon className="h-3 w-3 shrink-0 text-text-muted" />}
          <span className="max-w-[140px] truncate">{displayName}</span>
          {tabAttention ? (
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400"
              aria-hidden="true"
              title="Needs attention"
            />
          ) : (
            tabActivity &&
            ACTIVITY_DOT_CLASS[tabActivity] && (
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ACTIVITY_DOT_CLASS[tabActivity])}
                aria-hidden="true"
              />
            )
          )}
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleCloseTab(tab.id);
        }}
        className={cn(
          "ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "hover:bg-white/10",
        )}
        title="Close tab"
      >
        <X className="h-2.5 w-2.5" />
      </button>
      {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />}
    </div>
  );
}
