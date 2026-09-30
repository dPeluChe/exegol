import type { Agent } from "@exegol/shared";
import { toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { findFirstPaneId, getProjectState, useWorkspaceStore } from "../stores/workspace";
import { trpcMutate } from "./trpc-client";

/** Start a shell in the project's folder (or `cwd` inside it) and show it in `paneId` */
export async function spawnShellIntoPane(
  projectId: string,
  paneId: string,
  taskDescription = "Terminal",
  /** Start folder inside the project (the launcher's "run in" chips) */
  cwd?: string,
): Promise<string> {
  const agent = await trpcMutate<Agent>("agents.spawn", {
    projectId,
    cliType: "shell",
    taskDescription,
    ...(cwd ? { cwdOverride: cwd } : {}),
  });
  useAgentStore.getState().addAgent(toAgentState(agent, { activityLevel: "busy" }));
  useTerminalStore.getState().createTerminal(agent.id);
  useWorkspaceStore.getState().updatePane(paneId, { type: "terminal", agentId: agent.id });
  return agent.id;
}

/** Run a command in a new tab's shell, typed once the shell is ready (its first output, or 2s
 *  for a shell that prints no prompt): the palette's `!cmd`, a CLI update */
export async function runCommandInNewTab(projectId: string, cmd: string): Promise<void> {
  const agent = await trpcMutate<Agent>("agents.spawn", {
    projectId,
    cliType: "shell",
    taskDescription: `! ${cmd}`,
  });
  useAgentStore.getState().addAgent(toAgentState(agent, { activityLevel: "busy" }));
  useTerminalStore.getState().createTerminal(agent.id);
  const store = useWorkspaceStore.getState();
  const tabId = store.addTab(`! ${cmd.slice(0, 30)}`);
  const tab = getProjectState().tabs.find((t) => t.id === tabId);
  const paneId = tab ? findFirstPaneId(tab.layout) : null;
  if (paneId) store.updatePane(paneId, { type: "terminal", agentId: agent.id });

  let typed = false;
  const type = () => {
    if (typed) return;
    typed = true;
    unsub();
    window.api.terminal.write(agent.id, `${cmd}\n`);
  };
  const unsub = window.api.terminal.onData(agent.id, type);
  setTimeout(type, 2000);
}
