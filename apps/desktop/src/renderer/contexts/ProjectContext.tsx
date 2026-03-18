import type { Project } from "@exegol/shared";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useAgents, useProject } from "../hooks/use-trpc";
import { type AgentState, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";

export interface ProjectContextValue {
  project: Project | null;
  projectId: string | null;
  isLoading: boolean;
  /** Agents filtered for the active project */
  agents: AgentState[];
  /** Count of agents with status 'running' */
  runningAgentCount: number;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project, isLoading } = useProject(activeProjectId);
  const { data: dbAgents } = useAgents(activeProjectId);
  const syncFromDb = useAgentStore((s) => s.syncFromDb);
  const allAgents = Object.values(useAgentStore((s) => s.agents));

  // Guard: if the persisted project no longer exists in DB, reset to project list.
  // Kept as effect because it reacts to an async query result, not a user action.
  useEffect(() => {
    if (activeProjectId && !isLoading && !project) {
      useAppStore.getState().setActiveProject(null);
    }
  }, [activeProjectId, isLoading, project]);

  // Sync DB agents into Zustand store when they load.
  // Ideally this would use TanStack Query's onSuccess, but v5 removed that callback.
  // Kept as effect for cross-store synchronization (TanStack Query -> Zustand).
  useEffect(() => {
    if (dbAgents && activeProjectId) {
      syncFromDb(activeProjectId, dbAgents);
    }
  }, [dbAgents, activeProjectId, syncFromDb]);

  const value = useMemo<ProjectContextValue>(() => {
    const agents = activeProjectId ? allAgents.filter((a) => a.projectId === activeProjectId) : [];
    const runningAgentCount = agents.filter((a) => a.status === "running").length;

    return {
      project: project ?? null,
      projectId: activeProjectId,
      isLoading,
      agents,
      runningAgentCount,
    };
  }, [activeProjectId, project, isLoading, allAgents]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within a <ProjectProvider>");
  }
  return ctx;
}
