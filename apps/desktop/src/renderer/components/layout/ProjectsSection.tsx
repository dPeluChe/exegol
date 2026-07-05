import type { Project } from "@exegol/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsDownUp, FolderPlus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  useCreateProjectGroup,
  useProjectGroups,
  useProjects,
  useSetProjectGroup,
} from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import type { AgentState } from "../../stores/agents";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { GROUP_COLORS } from "./GroupIconColorPicker";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { ProjectItem } from "./ProjectItem";

interface ProjectsSectionProps {
  onAddProject: () => void;
}

/** Reorder a subset of `all` in-place at their original slots. */
function reorderWithinSection(
  all: Project[],
  sectionIds: Set<string>,
  newOrder: Project[],
): Project[] {
  let i = 0;
  return all.map((p) => (sectionIds.has(p.id) ? (newOrder[i++] as Project) : p));
}

interface ProjectListSectionProps {
  list: Project[];
  allProjects: Project[];
  activeProjectId: string | null;
  expandedIds: Set<string>;
  agentsById: Record<string, AgentState>;
  draggedProjectIdRef: React.MutableRefObject<string | null>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

/** A flat, reorderable list of projects — either "ungrouped" or one group's members. */
function ProjectListSection({
  list,
  allProjects,
  activeProjectId,
  expandedIds,
  agentsById,
  draggedProjectIdRef,
  onSelect,
  onToggle,
  onRename,
}: ProjectListSectionProps) {
  const queryClient = useQueryClient();
  const dragIndexRef = useRef<number | null>(null);
  const ids = new Set(list.map((p) => p.id));

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
    draggedProjectIdRef.current = list[index]?.id ?? null;
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (targetIndex: number) => {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    // Always clear the shared ref: a within-section reorder that leaves it set
    // would make a later unrelated drop on a group header silently move this
    // project into that group.
    draggedProjectIdRef.current = null;
    if (fromIndex === null || fromIndex === targetIndex) return;

    const reordered = [...list];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);

    const merged = reorderWithinSection(allProjects, ids, reordered);
    await trpcMutate("projects.reorder", { orderedIds: merged.map((p) => p.id) });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <div className="space-y-0.5">
      {list.map((project, index) => (
        <ProjectItem
          key={project.id}
          project={project}
          isSelected={project.id === activeProjectId}
          isExpanded={expandedIds.has(project.id)}
          onSelect={() => onSelect(project.id)}
          onToggle={() => onToggle(project.id)}
          onRename={onRename}
          agents={Object.values(agentsById).filter((a) => a.projectId === project.id)}
          index={index}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}

export function ProjectsSection({ onAddProject: _onAddProject }: ProjectsSectionProps) {
  const { data: projects } = useProjects();
  const { data: groups } = useProjectGroups();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const agents = useAgentStore((s) => s.agents);
  const queryClient = useQueryClient();
  const setProjectGroup = useSetProjectGroup();
  const createGroup = useCreateProjectGroup();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  /** Shared across sections so a group header can accept a drop from any list. */
  const draggedProjectIdRef = useRef<string | null>(null);

  const toggleProject = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await trpcMutate("projects.rename", { id, name });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    [queryClient],
  );

  const handleAddGroup = () => {
    createGroup.mutate({
      name: "New Group",
      color: GROUP_COLORS[0] ?? "#3B82F6",
      icon: "Folder",
      background: null,
    });
  };

  if (!projects || projects.length === 0) {
    return <p className="py-2 text-center text-xs text-text-muted">No projects yet</p>;
  }

  // Zero visual change for users who never created a group.
  const hasGroups = (groups?.length ?? 0) > 0;

  const collapseAllButton = expandedIds.size > 0 && (
    <button
      type="button"
      onClick={() => setExpandedIds(new Set())}
      className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-text-muted hover:text-text-secondary"
      title="Collapse all"
    >
      <ChevronsDownUp className="h-2.5 w-2.5" />
      <span>Collapse all</span>
    </button>
  );

  if (!hasGroups) {
    return (
      <div className="space-y-0.5">
        {collapseAllButton}
        <ProjectListSection
          list={projects}
          allProjects={projects}
          activeProjectId={activeProjectId}
          expandedIds={expandedIds}
          agentsById={agents}
          draggedProjectIdRef={draggedProjectIdRef}
          onSelect={setActiveProject}
          onToggle={toggleProject}
          onRename={handleRename}
        />
      </div>
    );
  }

  const grouped = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.groupId) continue;
    const list = grouped.get(p.groupId) ?? [];
    list.push(p);
    grouped.set(p.groupId, list);
  }
  const ungrouped = projects.filter((p) => !p.groupId);

  const dropOnGroup = (groupId: string | null) => {
    const draggedId = draggedProjectIdRef.current;
    draggedProjectIdRef.current = null;
    setDropTargetGroupId(null);
    if (!draggedId) return;
    setProjectGroup.mutate({ id: draggedId, groupId });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        {collapseAllButton}
        <button
          type="button"
          onClick={handleAddGroup}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[9px] text-text-muted hover:text-text-secondary"
          title="New group"
        >
          <FolderPlus className="h-2.5 w-2.5" />
          <span>New group</span>
        </button>
      </div>

      {(groups ?? []).map((group) => (
        <div key={group.id}>
          <ProjectGroupHeader
            group={group}
            projectCount={grouped.get(group.id)?.length ?? 0}
            isDropTarget={dropTargetGroupId === group.id}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setDropTargetGroupId(group.id)}
            onDragLeave={() => setDropTargetGroupId(null)}
            onDrop={() => dropOnGroup(group.id)}
          />
          {!group.collapsed && (
            <div className="ml-3">
              <ProjectListSection
                list={grouped.get(group.id) ?? []}
                allProjects={projects}
                activeProjectId={activeProjectId}
                expandedIds={expandedIds}
                agentsById={agents}
                draggedProjectIdRef={draggedProjectIdRef}
                onSelect={setActiveProject}
                onToggle={toggleProject}
                onRename={handleRename}
              />
            </div>
          )}
        </div>
      ))}

      <div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target to ungroup a project */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setDropTargetGroupId("__ungrouped__")}
          onDragLeave={() => setDropTargetGroupId(null)}
          onDrop={() => dropOnGroup(null)}
          className="mb-0.5 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
          style={
            dropTargetGroupId === "__ungrouped__"
              ? { backgroundColor: "rgba(255,255,255,0.05)" }
              : undefined
          }
        >
          Ungrouped
        </div>
        <ProjectListSection
          list={ungrouped}
          allProjects={projects}
          activeProjectId={activeProjectId}
          expandedIds={expandedIds}
          agentsById={agents}
          draggedProjectIdRef={draggedProjectIdRef}
          onSelect={setActiveProject}
          onToggle={toggleProject}
          onRename={handleRename}
        />
      </div>
    </div>
  );
}
