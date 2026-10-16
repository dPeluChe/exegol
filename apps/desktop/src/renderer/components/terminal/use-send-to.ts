import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { pasteToAgent } from "../../lib/agent-input";
import { agentAsksQuestion } from "../../lib/agent-question";
import { focusActivePane } from "../../lib/pane-focus";
import { trpcInvoke } from "../../lib/trpc-client";
import { jumpToAgent, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useToastStore } from "../../stores/toasts";
import { collectPaneIds, useWorkspaceStore } from "../../stores/workspace";
import type { ProjectWorkspace } from "../../stores/workspace/types";
import {
  buildSendSections,
  type SendEnterPrefs,
  type SendSections,
  type SendTarget,
  sendAction,
  type TargetGroup,
  tabTargetGroups,
} from "./send-targets";

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

export interface TargetPicker {
  groups: TargetGroup[];
  /** CLI session names by agent id */
  names: Record<string, string>;
}

/** Agents a report from `paneId` can go to: its tab, the project's other tabs, other projects */
export function useTabTargets(projectId: string | undefined, paneId: string): TargetPicker {
  const sections = useSendSections("", projectId, true);
  const pw = useWorkspaceStore((s) => (projectId ? s.projectWorkspaces[projectId] : undefined));
  const groups = useMemo(() => {
    const tab = pw?.tabs.find((t) => collectPaneIds(t.layout).includes(paneId));
    const ids = (tab ? collectPaneIds(tab.layout) : []).map((id) => pw?.panes[id]?.agentId);
    return tabTargetGroups(sections, new Set(ids.filter((id): id is string => !!id)));
  }, [sections, pw, paneId]);
  return { groups, names: useCliSessionNames(sections) };
}

/** Each agent's session name inside its CLI, by agent id (the launcher chips' source), one query
 *  per project; names fill in once the CLI's store is read */
export function useCliSessionNames(sections: SendSections): Record<string, string> {
  const groups = [...(sections.own ? [sections.own] : []), ...sections.others];
  const results = useQueries({
    queries: groups.map((g) => {
      const agentIds = g.targets
        .filter((t) => t.cliType !== "shell")
        .slice(0, 20)
        .map((t) => t.id);
      return {
        queryKey: ["sendToSessionNames", g.projectId, agentIds],
        queryFn: () =>
          trpcInvoke<Record<string, string>>("agents.sessionNames", {
            projectId: g.projectId,
            agentIds,
          }),
        enabled: agentIds.length > 0,
        staleTime: 30_000,
      };
    }),
  });
  return Object.assign({}, ...results.map((r) => r.data ?? {}));
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

/** The paste is consumed first: in one write a TUI could read the Enter as part of it */
const ENTER_DELAY_MS = 50;

/** Pasted (multi-line as one bracketed paste, so a shell never runs it line by line), then Enter
 *  only when the setting for that kind of target asks, and never into an agent's question */
export async function sendSelectionTo(
  text: string,
  target: SendTarget,
  prefs: SendEnterPrefs,
): Promise<void> {
  if (!text) return;
  const wantsEnter = sendAction(target, prefs, false) === "enter";
  const asks = wantsEnter && target.cliType !== "shell" && (await agentAsksQuestion(target.id));
  const action = sendAction(target, prefs, asks);
  pasteToAgent(target.id, text);
  if (action === "enter") {
    setTimeout(() => window.api.terminal.write(target.id, "\r"), ENTER_DELAY_MS);
  } else if (action === "held") {
    useToastStore.getState().addToast({
      type: "info",
      title: `Pasted, not submitted: ${target.name} is asking a question`,
    });
  }
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
