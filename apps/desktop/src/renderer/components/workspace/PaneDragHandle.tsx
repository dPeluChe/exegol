import { cn } from "@exegol/ui";
import { GripVertical } from "lucide-react";
import type { DragEvent } from "react";
import { getProjectState, layoutHasPane, useWorkspaceStore } from "../../stores/workspace";

export const PANE_DRAG_TYPE = "application/exegol-pane";

export interface PaneDragPayload {
  paneId: string;
  tabId: string;
}

export function readPaneDrag(e: DragEvent): PaneDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(PANE_DRAG_TYPE);
    return raw ? (JSON.parse(raw) as PaneDragPayload) : null;
  } catch {
    return null;
  }
}

const DRAG_HINT =
  "Drag onto a tab to move it there, onto the tab bar for a new tab, or onto another pane's edge";

/** Grip that drags a pane: onto another pane's edge (WorkspacePane), a tab or the tab bar
 *  (WorkspaceTabBar). Hidden while the pane floats */
export function PaneDragHandle({
  paneId,
  className,
  iconClassName = "h-3 w-3",
}: {
  paneId: string;
  className?: string;
  iconClassName?: string;
}) {
  const floating = useWorkspaceStore((s) => !!s.floatingPanes[paneId]);
  if (floating) return null;

  const onDragStart = (e: DragEvent) => {
    const tab = getProjectState().tabs.find((t) => layoutHasPane(t.layout, paneId));
    if (!tab) return e.preventDefault();
    const payload: PaneDragPayload = { paneId, tabId: tab.id };
    e.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag handle, the context menu offers the same moves
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        "flex cursor-grab items-center justify-center rounded text-accent hover:bg-accent/15 active:cursor-grabbing",
        className,
      )}
      title={DRAG_HINT}
    >
      <GripVertical className={iconClassName} />
    </div>
  );
}
