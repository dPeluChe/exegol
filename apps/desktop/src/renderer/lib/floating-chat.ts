import type { Agent, AgentCliType, AgentStatus } from "@exegol/shared";

/** One window for the Commander's chat: opening it again focuses it */
export const COMMANDER_CHAT_PANE = "commander-chat";

export const floatingChatKey = (agentId: string) => ["floatingChat", agentId];

type StatusPush = Pick<
  AgentStatusEvent,
  "status" | "currentStep" | "cliType" | "launchedInShell" | "statusChangedAt" | "claudeSessionId"
>;

/** The session row a floating chat holds, moved on by a status push (it has no agents store feed) */
export function withStatusPush(agent: Agent, push: StatusPush): Agent {
  return {
    ...agent,
    status: push.status as AgentStatus,
    currentStep: push.currentStep,
    cliType: push.cliType as AgentCliType,
    launchedInShell: push.launchedInShell ?? agent.launchedInShell,
    statusChangedAt: push.statusChangedAt ?? agent.statusChangedAt,
    claudeSessionId: push.claudeSessionId ?? agent.claudeSessionId,
  };
}
