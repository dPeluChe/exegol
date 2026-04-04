import { useMemo, useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const effectiveExpandedIds = useMemo(() => {
    const ids = new Set(expandedIds);
    if (activeProjectId) ids.add(activeProjectId);
    return ids;
  }, [expandedIds, activeProjectId]);

  const toggleProject = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {projects && projects.length > 0 ? (
        projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={project.id === activeProjectId}
            isExpanded={effectiveExpandedIds.has(project.id)}
            onSelect={() => setActiveProject(project.id)}
            onToggle={() => toggleProject(project.id)}
            agents={Object.values(agents).filter((a) => a.projectId === project.id)}
          />
        ))
      ) : (
        <p className="py-2 text-center text-xs text-text-muted">No projects yet</p>
      )}
    </div>
  );
}
