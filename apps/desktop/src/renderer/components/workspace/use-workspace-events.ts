import { useEffect, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { switchSection } from "../../lib/switch-section";
import { trpcInvoke } from "../../lib/trpc-client";
import { jumpToAgent, useAgentStore } from "../../stores/agents";
import { getActivePaneId, useWorkspaceStore } from "../../stores/workspace";

/** Cmd+N / "New agent with same task" and Cmd+Shift+N open the spawn modals */
export function useSpawnModalEvents() {
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [spawnInitialTask, setSpawnInitialTask] = useState<string | undefined>(undefined);
  const [spawnInitialCliType, setSpawnInitialCliType] = useState<string | undefined>(undefined);
  const [showParallelModal, setShowParallelModal] = useState(false);

  // Listen for Cmd+N spawn-agent hotkey OR T106 "New agent with same task"
  // (which passes detail.taskDescription + detail.cliType for pre-fill).
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { taskDescription?: string; cliType?: string }
        | undefined;
      setSpawnInitialTask(detail?.taskDescription);
      setSpawnInitialCliType(detail?.cliType);
      setShowSpawnModal(true);
    };
    window.addEventListener("exegol:spawn-agent", handler);
    return () => window.removeEventListener("exegol:spawn-agent", handler);
  });

  // Listen for Cmd+Shift+N parallel-spawn hotkey (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = () => setShowParallelModal(true);
    window.addEventListener("exegol:spawn-parallel", handler);
    return () => window.removeEventListener("exegol:spawn-parallel", handler);
  });

  const closeSpawnModal = () => {
    setShowSpawnModal(false);
    setSpawnInitialTask(undefined);
    setSpawnInitialCliType(undefined);
  };

  return {
    showSpawnModal,
    spawnInitialTask,
    spawnInitialCliType,
    closeSpawnModal,
    showParallelModal,
    closeParallelModal: () => setShowParallelModal(false),
  };
}

/** Cmd+/ toggles the shortcut help overlay */
export function useShortcutsOverlay() {
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Listen for Cmd+/ shortcut help overlay (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = () => setShowShortcuts((prev) => !prev);
    window.addEventListener("exegol:show-shortcuts", handler);
    return () => window.removeEventListener("exegol:show-shortcuts", handler);
  });
  return { showShortcuts, closeShortcuts: () => setShowShortcuts(false) };
}

/** "Open" (T107 comparator) and "View diff" (T106 stop reason) jump to an agent's pane */
export function useAgentNavigationEvents() {
  // T107 comparator "Open" → the agent's pane, or a new tab if it has none
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      const agentId = detail?.agentId;
      if (!agentId) return;
      const agent = useAgentStore.getState().agents[agentId];
      if (agent) jumpToAgent(agentId, agent.projectId);
    };
    window.addEventListener("exegol:focus-agent", handler);
    return () => window.removeEventListener("exegol:focus-agent", handler);
  });

  // T106 stop-reason "View diff" → repoint the focused (or first) pane of
  // the active tab to the git view scoped to that agent's worktree.
  useMountEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      const agentId = detail?.agentId;
      if (!agentId) return;
      void openDiffForAgent(agentId);
    };
    window.addEventListener("exegol:view-diff", handler);
    return () => window.removeEventListener("exegol:view-diff", handler);
  });
}

/** Force xterm.js terminals to re-fit when switching back to Agents tab */
export function useRefitOnAgentsShown(isAgents: boolean) {
  const prevIsAgents = useRef(isAgents);
  useEffect(() => {
    if (isAgents && !prevIsAgents.current) {
      dispatchRefitTerminals();
    }
    prevIsAgents.current = isAgents;
  }, [isAgents]);
}

/**
 * Find the agent's worktree on the main process side, then update the
 * currently focused (or first) pane in the active tab to the git view
 * scoped to that worktree.
 */
async function openDiffForAgent(agentId: string): Promise<void> {
  let worktreePath: string | undefined;
  try {
    const path = await trpcInvoke<string | null>("agents.getWorktreePath", { agentId });
    worktreePath = path ?? undefined;
  } catch {
    /* no worktree row — fall back to project root */
  }
  const ws = useWorkspaceStore.getState();
  const paneId = getActivePaneId();
  if (!paneId) return;
  ws.updatePane(paneId, { type: "git", agentId, filePath: worktreePath });
  ws.setFocusedPane(paneId);
  switchSection("agents");
}
