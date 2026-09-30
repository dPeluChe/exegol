import { type Agent, type AgentCliType, MODEL_LAUNCH } from "@exegol/shared";
import { useCallback, useState } from "react";
import { switchSection } from "../../lib/switch-section";
import { trpcMutate } from "../../lib/trpc-client";
import { toAgentState, useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import {
  findFirstPaneId,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import type { SpawnForm } from "./use-spawn-form";

function resumeInput({ localSessionId, useWorktree, session }: SpawnForm) {
  if (localSessionId && !useWorktree) {
    return { resumeSession: true, resumeLocalSessionId: localSessionId };
  }
  if (session === "last") return { resumeSession: true };
  if (session) return { resumeSession: true, resumeFromAgentId: session.agentId };
  return {};
}

function spawnInput(projectId: string, c: SpawnForm) {
  return {
    projectId,
    cliType: c.providerId as AgentCliType,
    taskDescription: c.task.trim(),
    useWorktree: c.useWorktree,
    branchName: c.useWorktree && c.branchName ? c.branchName : undefined,
    accessMode: c.accessMode,
    skillNames: c.selectedSkills.size > 0 ? Array.from(c.selectedSkills) : undefined,
    yolo: c.yoloFlag && c.yolo !== null ? c.yolo : undefined,
    baseBranch: c.useWorktree && c.baseBranch ? c.baseBranch : undefined,
    model: MODEL_LAUNCH[c.providerId] && c.model.trim() ? c.model.trim() : undefined,
    name: c.name.trim() || undefined,
    ...resumeInput(c),
  };
}

// T95: Reuse focused empty pane, otherwise create a new tab
function placeInWorkspace(agentId: string, targetPaneId: string | undefined) {
  const store = useWorkspaceStore.getState();
  if (targetPaneId) {
    store.updatePane(targetPaneId, { type: "terminal", agentId });
    return;
  }
  const freshPw = getProjectState();
  const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
  const focusedId = activeTab ? getFocusedOrFirstPaneId(activeTab) : null;
  const focusedPane = focusedId ? freshPw.panes[focusedId] : null;

  if (focusedPane?.type === "empty" && focusedId) {
    store.updatePane(focusedId, { type: "terminal", agentId });
    return;
  }
  const newTabId = store.addTab();
  const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
  const paneId = newTab ? findFirstPaneId(newTab.layout) : null;
  if (paneId) store.updatePane(paneId, { type: "terminal", agentId });
}

/** Spawns the agent, registers it in the stores and shows it in a pane. */
export function useSpawnAgent({
  projectId,
  targetPaneId,
  onClose,
}: {
  projectId: string;
  targetPaneId?: string;
  onClose: () => void;
}) {
  const [spawning, setSpawning] = useState(false);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  const spawn = useCallback(
    async (form: SpawnForm) => {
      setSpawning(true);
      try {
        const agent = await trpcMutate<Agent>("agents.spawn", spawnInput(projectId, form));
        addAgent(
          toAgentState(agent, {
            activityLevel: "busy",
            branchName: agent.branchName ?? (form.useWorktree ? form.branchName : null),
          }),
        );
        createTerminal(agent.id);
        setFocusedAgent(agent.id);
        // Switch to Agents section
        switchSection("agents");
        placeInWorkspace(agent.id, targetPaneId);
        onClose();
      } catch (err) {
        console.error("[SpawnAgentModal] Spawn failed:", err);
      } finally {
        setSpawning(false);
      }
    },
    [projectId, addAgent, createTerminal, setFocusedAgent, onClose, targetPaneId],
  );

  return { spawning, spawn };
}
