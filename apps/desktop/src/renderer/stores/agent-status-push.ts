import type { AgentCliType, AgentStatus } from "@exegol/shared";
import type { QueryClient } from "@tanstack/react-query";
import { MCP_STATUS_KEY } from "../hooks/use-mcp-status";
import { applyRecoveredCrashes, RECOVERY_KEY } from "../lib/session-recovery";
import { type AgentState, followUpsKey, guessesQuestion, shellClosesOn } from "./agent-state";
import { useAgentStore } from "./agents";
import { noteDeskActivity } from "./desk-activity";
import { useWorkspaceStore } from "./workspace";

// ─── Push event subscription (T17) ──────────────────────────────────────

let pushCleanup: (() => void) | null = null;

/** Start listening for agent status push events from main process */
export function startAgentStatusPush(queryClient: QueryClient): void {
  if (pushCleanup) return; // Already subscribed
  // "info": action_needed clears when the agent runs, and this message makes it run
  const offPrWatch = window.api.onPrWatch(({ agentId, reason }) => {
    if (reason) useAgentStore.getState().addAttentionItem(agentId, { level: "info", reason });
  });
  // "info": action_needed clears on the next running push, and a stuck turn is still running
  const offStuckTurn = window.api.onStuckTurn(({ agentId, reason }) =>
    useAgentStore.getState().addAttentionItem(agentId, { level: "info", reason, stuck: true }),
  );
  const offActivity = window.api.onAgentActivity(({ agentId, activity }) =>
    noteDeskActivity(agentId, activity),
  );
  // "info": action_needed clears on the next running push, and a dialog is not a question it asked
  const offMessageHeld = window.api.onMessageHeld(({ agentId, reason }) =>
    useAgentStore.getState().addAttentionItem(agentId, { level: "info", reason }),
  );
  const offRenamed = window.api.onAgentRenamed(({ agentId, alias, cliName }) =>
    useAgentStore.getState().updateAgent(agentId, { cliName, ...(alias ? { alias } : {}) }),
  );
  const stopMcp = window.api.onMcpStatus((e) => queryClient.setQueryData(MCP_STATUS_KEY, e));
  const stopFollowUps = window.api.onFollowUps((e) =>
    queryClient.setQueryData(followUpsKey(e.agentId), e.items),
  );
  const stopTurns = window.api.onTurnChanges((event) =>
    queryClient.invalidateQueries({ queryKey: ["oplog", "turn", event.agentId] }),
  );
  const stopStatus = window.api.onAgentStatus((event) => {
    const store = useAgentStore.getState();
    const existing = store.agents[event.agentId];
    if (existing) {
      const isFinalStatus = ["completed", "failed", "stopped", "crashed"].includes(event.status);

      if (shellClosesOn(event.status) && existing.cliType === "shell") {
        store.removeAgent(event.agentId);
        useWorkspaceStore.getState().releaseAgent(event.agentId);
        return;
      }
      if (event.status === "crashed" && existing.cliType === "shell") {
        // Kept for its pane (auto-resume reopens it); a shell never asks for attention
        store.updateAgent(event.agentId, { status: "crashed", currentStep: event.currentStep });
        return;
      }

      const newStatus = event.status as AgentStatus;
      const update: Partial<AgentState> = {
        status: newStatus,
        currentStep: event.currentStep,
      };
      if (event.claudeSessionId) update.claudeSessionId = event.claudeSessionId;
      // A CLI typed in the terminal made it that agent (or another one)
      if (event.cliType !== existing.cliType) update.cliType = event.cliType as AgentCliType;
      if (event.alias !== undefined) update.alias = event.alias;
      if (event.launchedInShell !== undefined) update.launchedInShell = event.launchedInShell;
      if (event.statusChangedAt && newStatus !== existing.status) {
        update.activitySince = event.statusChangedAt;
      }
      store.updateAgent(event.agentId, update);

      // Add to attention inbox (markUnread is now derived from this).
      // waiting_input alone is a TURN BOUNDARY (T123: every reply ends there)
      // — only real attention (permission prompt/question) earns an inbox
      // entry, or idle agents show amber dots forever (verify round 3).
      const needsAttention = event.needsAttention === true;
      // A CLI with no signal of its own: its running→waiting move is the only hint of a question
      const scrapedAttention = guessesQuestion(existing, event);
      if (
        isFinalStatus ||
        (event.status === "waiting_input" && (needsAttention || scrapedAttention))
      ) {
        store.addAttentionItem(event.agentId);
      } else if (newStatus === "running") {
        // Answering the prompt RESOLVES the attention (verify round 3: items
        // stayed amber for 54m after approval). Review items for finished
        // agents stay until dismissed — only action_needed auto-clears.
        const item = useAgentStore.getState().attentionItems[event.agentId];
        if (item && item.level === "action_needed" && !item.paneId) {
          store.dismissAttention(event.agentId);
        }
      } else if (event.turnEnded) {
        store.noteTurnUnseen(event.agentId);
      }
    }
  });
  const stopRecovery = window.api.onRecoveryProgress((state) => {
    queryClient.setQueryData(RECOVERY_KEY, state);
    if (!state.done) return;
    useAgentStore.setState((s) => ({ agents: applyRecoveredCrashes(s.agents, state.crashed) }));
    // Panes and lists read DB statuses from before the sweep
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    queryClient.invalidateQueries({ queryKey: ["agent"] });
  });
  pushCleanup = () => {
    stopRecovery();
    offPrWatch();
    offStuckTurn();
    offActivity();
    offMessageHeld();
    offRenamed();
    stopMcp();
    stopFollowUps();
    stopTurns();
    stopStatus();
  };
}

/** Stop listening for push events */
export function stopAgentStatusPush(): void {
  pushCleanup?.();
  pushCleanup = null;
}
