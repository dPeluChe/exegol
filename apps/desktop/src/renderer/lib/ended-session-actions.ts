import type { Agent, AgentAccessMode, AgentCliType } from "@exegol/shared";
import { deleteAgent } from "../hooks/use-delete-agent";
import { setPaneIn } from "../hooks/use-resume-agent";
import { toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { useWatchStore } from "../stores/watch";
import { dropPaneFocus, focusNewPane } from "./pane-focus";
import { projectBrowserUrl } from "./project-browser-url";
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

/** A new agent took the ended one's place: a Watching pin follows it, then the old row retires */
export function handOver(oldId: string, newId: string): void {
  useWatchStore.getState().replaceAgent(oldId, newId);
  retireEnded(oldId);
}

/** Show `created` in the pane (in whichever project holds it); a pane closed meanwhile stops it */
function placeNew(created: Agent, projectId: string, paneId: string): boolean {
  useAgentStore.getState().addAgent(toAgentState(created, { activityLevel: "busy" }));
  useTerminalStore.getState().createTerminal(created.id);
  if (setPaneIn(projectId, paneId, { type: "terminal", agentId: created.id })) return true;
  deleteAgent(created.id);
  return false;
}

async function spawnInto(
  input: Record<string, unknown>,
  projectId: string,
  paneId: string,
  fallback?: Record<string, unknown>,
): Promise<Agent | null> {
  focusNewPane(paneId);
  let created: Agent;
  try {
    created = await trpcMutate<Agent>("agents.spawn", input).catch((err) => {
      if (!fallback) throw err;
      return trpcMutate<Agent>("agents.spawn", fallback);
    });
  } catch (err) {
    dropPaneFocus(paneId);
    throw err;
  }
  return placeNew(created, projectId, paneId) ? created : null;
}

/** A fresh session of the same CLI where it worked (its worktree branch reused, else the folder
 *  the launcher started it in), with its model, YOLO and access mode, in `paneId` */
export async function newSessionInPane(
  agent: EndedSource,
  paneId: string,
  folder: string | null = null,
): Promise<void> {
  const base = {
    projectId: agent.projectId,
    cliType: agent.cliType,
    useWorktree: !!agent.branchName,
    branchName: agent.branchName ?? undefined,
    accessMode: agent.accessMode ?? undefined,
    model: agent.model ?? undefined,
    modelRoles: agent.modelRoles ?? undefined,
    yolo: agent.yolo ?? undefined,
  };
  const inFolder = !agent.branchName && folder;
  const created = await spawnInto(
    inFolder ? { ...base, cwdOverride: folder } : base,
    agent.projectId,
    paneId,
    inFolder ? base : undefined,
  );
  if (created) handOver(agent.id, created.id);
}

/** A shell in the session's folder (the root when main refuses that folder) */
export async function terminalInPane(
  agent: EndedSource,
  paneId: string,
  folder: string | null,
): Promise<void> {
  const base = { projectId: agent.projectId, cliType: "shell", taskDescription: "Terminal" };
  const created = await spawnInto(
    folder ? { ...base, cwdOverride: folder } : base,
    agent.projectId,
    paneId,
    folder ? base : undefined,
  );
  if (created) retireEnded(agent.id);
}

/** agentId cleared: releaseAgentPanes matches on it and would empty the pane on retire */
export function filesInPane(agent: EndedSource, paneId: string, folder: string | null): void {
  const patch = { type: "files" as const, agentId: undefined, filePath: folder ?? undefined };
  if (setPaneIn(agent.projectId, paneId, { ...patch, openFile: undefined })) {
    retireEnded(agent.id);
  }
}

export async function browserInPane(
  agent: EndedSource,
  projectPath: string | undefined,
  paneId: string,
): Promise<void> {
  const url = await projectBrowserUrl(agent.projectId, projectPath);
  if (setPaneIn(agent.projectId, paneId, { type: "browser", agentId: undefined, url })) {
    retireEnded(agent.id);
  }
}
