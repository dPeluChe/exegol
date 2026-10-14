import { useMemo } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { pasteToAgent } from "../../lib/agent-input";
import { focusActivePane } from "../../lib/pane-focus";
import { jumpToAgent, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useWorkspaceStore } from "../../stores/workspace";
import type { ProjectWorkspace } from "../../stores/workspace/types";
import { buildSendSections, type SendSections, type SendTarget } from "./send-targets";

const EMPTY: SendSections = { own: null, others: [] };

/** Where a selection in `agentId`'s terminal can go (agents and plain terminals). Built only while `enabled`: every agent push
 *  would redo it for every panel */
export function useSendSections(
  agentId: string,
  projectId: string | undefined,
  enabled: boolean,
): SendSections {
  const allAgents = useAgentStore((s) => s.agents);
  const projectOrder = useAppStore((s) => s.liveProjectOrder);
  const { data: projects = [] } = useProjects();
  const projectWorkspaces = useWorkspaceStore((s) => s.projectWorkspaces);
  const paneCwd = useWorkspaceStore((s) => s.paneCwd);
  return useMemo(
    () =>
      enabled
        ? buildSendSections(
            Object.values(allAgents),
            agentId,
            new Map(projects.map((p) => [p.id, p.name])),
            projectId,
            projectOrder,
            shellFolders(projectWorkspaces, paneCwd),
          )
        : EMPTY,
    [enabled, allAgents, agentId, projects, projectId, projectOrder, projectWorkspaces, paneCwd],
  );
}

/** Each session's folder as its pane's shell last reported it (OSC 7) */
function shellFolders(
  projectWorkspaces: Record<string, ProjectWorkspace>,
  paneCwd: Record<string, string>,
): Map<string, string> {
  const folders = new Map<string, string>();
  for (const pw of Object.values(projectWorkspaces)) {
    for (const [paneId, pane] of Object.entries(pw.panes)) {
      const cwd = paneCwd[paneId];
      if (pane.agentId && cwd) folders.set(pane.agentId, cwd);
    }
  }
  return folders;
}

/** Pasted, never submitted: an agent gets context added, a shell gets the command reviewed before
 *  Enter. Multi-line is one bracketed paste, so a shell never runs it line by line */
export function sendSelectionTo(text: string, target: SendTarget): void {
  if (!text) return;
  pasteToAgent(target.id, text);
  jumpToAgent(target.id, target.projectId);
  focusActivePane();
}

/** A terminal pane's selection, for the pane's right-click menu (it wraps the terminal and cannot
 *  read its state). Keyed by pane id: one window, one terminal per pane */
export interface SelectionSource {
  agentId: string;
  projectId: string | undefined;
  getSelection: () => string;
}

const sources = new Map<string, SelectionSource>();

export function registerSelectionSource(paneId: string, source: SelectionSource): () => void {
  sources.set(paneId, source);
  return () => {
    if (sources.get(paneId) === source) sources.delete(paneId);
  };
}

export const selectionSourceFor = (paneId: string) => sources.get(paneId);
