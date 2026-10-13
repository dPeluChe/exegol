import type { Agent, AgentAccessMode, AgentCliType } from "@exegol/shared";
import { deleteAgent } from "../hooks/use-delete-agent";
import { toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { useWorkspaceStore } from "../stores/workspace";
import { dropPaneFocus, focusNewPane } from "./pane-focus";
import { projectBrowserUrl } from "./project-browser-url";
import { shellInPane } from "./split-terminal";
import { trpcMutate } from "./trpc-client";

/** The ended session's launch choices a fresh one in its place keeps */
export interface EndedSource {
  id: string;
  projectId: string;
  cliType: AgentCliType;
  branchName?: string | null;
  accessMode?: AgentAccessMode | null;
  model?: string | null;
  modelRoles?: Record<string, string> | null;
  yolo?: boolean | null;
}

/** The pane moved on: the ended row goes the way a pane close takes it (archived, shells deleted) */
export const retireEnded = (agentId: string) => deleteAgent(agentId);

/** A fresh session of the same CLI where it worked (its worktree branch reused), with its model,
 *  YOLO and access mode, in `paneId` */
export async function newSessionInPane(agent: EndedSource, paneId: string): Promise<void> {
  focusNewPane(paneId);
  let created: Agent;
  try {
    created = await trpcMutate<Agent>("agents.spawn", {
      projectId: agent.projectId,
      cliType: agent.cliType,
      useWorktree: !!agent.branchName,
      branchName: agent.branchName ?? undefined,
      accessMode: agent.accessMode ?? undefined,
      model: agent.model ?? undefined,
      modelRoles: agent.modelRoles ?? undefined,
      yolo: agent.yolo ?? undefined,
    });
  } catch (err) {
    dropPaneFocus(paneId);
    throw err;
  }
  useAgentStore.getState().addAgent(toAgentState(created, { activityLevel: "busy" }));
  useTerminalStore.getState().createTerminal(created.id);
  useWorkspaceStore.getState().updatePane(paneId, { type: "terminal", agentId: created.id });
  retireEnded(agent.id);
}

/** A shell in the session's folder (the root when that folder is gone) */
export async function terminalInPane(
  agentId: string,
  projectId: string,
  paneId: string,
  folder: string | null,
): Promise<void> {
  await shellInPane(projectId, paneId, folder ?? undefined);
  retireEnded(agentId);
}

export function filesInPane(agentId: string, paneId: string, folder: string | null): void {
  useWorkspaceStore
    .getState()
    .updatePane(paneId, { type: "files", filePath: folder ?? undefined, openFile: undefined });
  retireEnded(agentId);
}

export async function browserInPane(
  agentId: string,
  projectId: string,
  projectPath: string | undefined,
  paneId: string,
): Promise<void> {
  const url = await projectBrowserUrl(projectId, projectPath);
  useWorkspaceStore.getState().updatePane(paneId, { type: "browser", url });
  retireEnded(agentId);
}
