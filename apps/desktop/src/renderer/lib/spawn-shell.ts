import type { Agent } from "@exegol/shared";
import { toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { findFirstPaneId, getProjectState, useWorkspaceStore } from "../stores/workspace";
import type { CustomLayoutSlot, SlotAgent } from "./layout-presets";
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
  useAgentStore.getState().addAgent(toAgentState(agent));
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
  });
  useAgentStore.getState().addAgent(toAgentState(agent));
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

/** Fill a saved layout's terminal slots: a shell, or a fresh session of the agent CLI the slot
 *  had, with its model, YOLO and access mode. One at a time: CLIs starting together compete */
export async function fillLayoutSlots(
  projectId: string,
  spawns: { paneId: string; slot: CustomLayoutSlot }[],
): Promise<void> {
  for (const { paneId, slot } of spawns) {
    if (!slot.cliType || slot.cliType === "shell") {
      await spawnShellIntoPane(projectId, paneId);
      continue;
    }
    const agent = await trpcMutate<Agent>("agents.spawn", {
      projectId,
      cliType: slot.cliType,
      ...(slot.accessMode ? { accessMode: slot.accessMode } : {}),
      ...(slot.model ? { model: slot.model } : {}),
      ...(slot.yolo != null ? { yolo: slot.yolo } : {}),
    });
    useAgentStore.getState().addAgent(toAgentState(agent, { activityLevel: "busy" }));
    useTerminalStore.getState().createTerminal(agent.id);
    useWorkspaceStore.getState().updatePane(paneId, { type: "terminal", agentId: agent.id });
  }
}

/** What a terminal pane runs, for saving it into a layout slot */
export function slotAgentOf(agentId: string): SlotAgent | undefined {
  const a = useAgentStore.getState().agents[agentId];
  return a && { cliType: a.cliType, model: a.model, yolo: a.yolo, accessMode: a.accessMode };
}
