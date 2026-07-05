import type { ProjectGroup } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, PaintBucket, Pencil, Ungroup } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDeleteProjectGroup,
  useRenameProjectGroup,
  useSetProjectGroupAppearance,
  useSetProjectGroupCollapsed,
} from "../../hooks/use-trpc";
import { GroupIconColorPicker, resolveGroupIcon } from "./GroupIconColorPicker";

interface ProjectGroupHeaderProps {
  group: ProjectGroup;
  projectCount: number;
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
}

/** T146: collapsible sidebar folder header for a project group. */
export function ProjectGroupHeader({
  group,
  projectCount,
  isDropTarget,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: ProjectGroupHeaderProps) {
  const setCollapsed = useSetProjectGroupCollapsed();
  const renameGroup = useRenameProjectGroup();
  const setAppearance = useSetProjectGroupAppearance();
  const deleteGroup = useDeleteProjectGroup();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [disbandArmed, setDisbandArmed] = useState(false);

  const Icon = resolveGroupIcon(group.icon);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  useEffect(() => {
    if (!disbandArmed) return;
    const timer = setTimeout(() => setDisbandArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [disbandArmed]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const submitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) {
      renameGroup.mutate({ id: group.id, name: trimmed });
    }
    setEditing(false);
  }, [editName, group.id, group.name, renameGroup]);

  return (
    <div className="mb-0.5">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for cross-group drag */}
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <button
          type="button"
          onClick={() => setCollapsed.mutate({ id: group.id, collapsed: !group.collapsed })}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditName(group.name);
            setEditing(true);
          }}
          onContextMenu={handleContextMenu}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted transition-colors hover:bg-white/5",
            isDropTarget && "bg-accent/10 ring-1 ring-accent/50",
          )}
          style={group.background ? { backgroundColor: group.background } : undefined}
        >
          {group.collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? "#6B7280" }}
          />
          <Icon className="h-3 w-3 shrink-0" style={{ color: group.color ?? undefined }} />
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setEditing(false);
                e.stopPropagation();
              }}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 rounded bg-bg-tertiary px-1 py-0 text-[11px] normal-case text-text-primary outline-none ring-1 ring-accent/50"
            />
          ) : (
            <span className="flex-1 truncate normal-case">{group.name}</span>
          )}
          <span className="text-[9px] tabular-nums text-text-muted">{projectCount}</span>
        </button>
      </div>

      {pickerOpen && (
        <div className="ml-2 mt-1 rounded-md border border-border bg-bg-secondary">
          <GroupIconColorPicker
            color={group.color}
            icon={group.icon}
            onChange={(color, icon) => {
              setAppearance.mutate({ id: group.id, color, icon, background: group.background });
            }}
          />
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] rounded-md border border-border bg-bg-secondary py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setEditName(group.name);
              setEditing(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setPickerOpen((v) => !v);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
          >
            <PaintBucket className="h-3 w-3" />
            Color & Icon
          </button>
          <button
            type="button"
            onClick={() => {
              if (!disbandArmed) {
                setDisbandArmed(true);
                return;
              }
              setContextMenu(null);
              setDisbandArmed(false);
              deleteGroup.mutate(group.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 transition-colors hover:bg-white/10"
          >
            <Ungroup className="h-3 w-3" />
            {disbandArmed ? "Confirm disband?" : "Disband (keep projects)"}
          </button>
        </div>
      )}
    </div>
  );
}
