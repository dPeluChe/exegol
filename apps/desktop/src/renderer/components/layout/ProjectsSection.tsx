import { useQueryClient } from "@tanstack/react-query";
import { ChevronsDownUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { ProjectItem } from "./ProjectItem";

interface ProjectsSectionProps {
  onAddProject: () => void;
}

export function ProjectsSection({ onAddProject: _onAddProject }: ProjectsSectionProps) {
  const { data: projects } = useProjects();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const agents = useAgentStore((s) => s.agents);
  const queryClient = useQueryClient();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const dragIndexRef = useRef<number | null>(null);

  // Auto-expand when a project is selected (but don't force — collapse-all can override)
  useEffect(() => {
    if (activeProjectId) {
      setExpandedIds((prev) => {
        if (prev.has(activeProjectId)) return prev;
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
    }
  }, [activeProjectId]);

  const toggleProject = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await trpcMutate("projects.rename", { id, name });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    [queryClient],
  );

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, _index: number) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (targetIndex: number) => {
      const fromIndex = dragIndexRef.current;
      dragIndexRef.current = null;
      if (fromIndex === null || fromIndex === targetIndex || !projects) return;

      const reordered = [...projects];
      const [moved] = reordered.splice(fromIndex, 1);
      if (!moved) return;
      reordered.splice(targetIndex, 0, moved);

      const orderedIds = reordered.map((p) => p.id);
      await trpcMutate("projects.reorder", { orderedIds });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    [projects, queryClient],
  );

  return (
    <div className="space-y-0.5">
      {expandedIds.size > 0 && (
        <button
          type="button"
          onClick={() => setExpandedIds(new Set())}
          className="mb-0.5 flex w-full items-center gap-1 px-2 py-0.5 text-[9px] text-text-muted hover:text-text-secondary"
          title="Collapse all"
        >
          <ChevronsDownUp className="h-2.5 w-2.5" />
          <span>Collapse all</span>
        </button>
      )}
      {projects && projects.length > 0 ? (
        projects.map((project, index) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={project.id === activeProjectId}
            isExpanded={expandedIds.has(project.id)}
            onSelect={() => setActiveProject(project.id)}
            onToggle={() => toggleProject(project.id)}
            onRename={handleRename}
            agents={Object.values(agents).filter((a) => a.projectId === project.id)}
            index={index}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))
      ) : (
        <p className="py-2 text-center text-xs text-text-muted">No projects yet</p>
      )}
    </div>
  );
}
