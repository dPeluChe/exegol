import type { Project } from "@exegol/shared";
import { createContext, useContext, useMemo } from "react";
import { useProject } from "../hooks/use-trpc";
import { useProjectContext } from "./ProjectContext";

interface ProjectScopeValue {
  projectId: string | null;
  project: Project | null;
  /** The layer is the active project's: hidden kept layers stop polling and mount no webview */
  shown: boolean;
}

const ProjectScopeContext = createContext<ProjectScopeValue | null>(null);

/** One project's Agents layer: its panes read this project, not the active one */
export function ProjectScope({
  projectId,
  shown,
  children,
}: {
  projectId: string;
  shown: boolean;
  children: React.ReactNode;
}) {
  const { data: project } = useProject(projectId);
  const value = useMemo(
    () => ({ projectId, project: project ?? null, shown }),
    [projectId, project, shown],
  );
  return <ProjectScopeContext.Provider value={value}>{children}</ProjectScopeContext.Provider>;
}

/** The project of the pane this renders in (its ProjectScope), else the active project */
export function usePaneProject(): ProjectScopeValue {
  const scope = useContext(ProjectScopeContext);
  const { projectId, project } = useProjectContext();
  return scope ?? { projectId, project, shown: true };
}
