import type { Project } from "@exegol/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useMountEffect } from "../hooks/use-mount-effect";
import { useAgents, useProject } from "../hooks/use-trpc";
import { startAgentBrowserPush } from "../stores/agent-browser";
// Stale activeProjectId is cleaned up by useAutoSelectProject in App.tsx.
import {
  type AgentState,
  startAgentStatusPush,
  stopAgentStatusPush,
  useAgentStore,
} from "../stores/agents";
import { useAppStore } from "../stores/app";

interface ProjectContextValue {
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
  const agentsRecord = useAgentStore((s) => s.agents);
  const queryClient = useQueryClient();

  // T17: Subscribe to push events for agent status updates (Rule 4: external system sync)
  useMountEffect(() => {
    startAgentStatusPush(queryClient);
    const stopBrowser = startAgentBrowserPush(true);
    return () => {
      stopAgentStatusPush();
      stopBrowser();
    };
  });

  // Sync DB agents into Zustand store when they load.
  // Ideally this would use TanStack Query's onSuccess, but v5 removed that callback.
  // Kept as effect for cross-store synchronization (TanStack Query -> Zustand).
  useEffect(() => {
    if (dbAgents && activeProjectId) {
      syncFromDb(activeProjectId, dbAgents);
    }
  }, [dbAgents, activeProjectId, syncFromDb]);

  const value = useMemo<ProjectContextValue>(() => {
    const agents = activeProjectId
      ? Object.values(agentsRecord).filter((a) => a.projectId === activeProjectId)
      : [];
    const runningAgentCount = agents.filter((a) => a.status === "running").length;

    return {
      project: project ?? null,
      projectId: activeProjectId,
      isLoading,
      agents,
      runningAgentCount,
    };
  }, [activeProjectId, project, isLoading, agentsRecord]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within a <ProjectProvider>");
  }
  return ctx;
}
