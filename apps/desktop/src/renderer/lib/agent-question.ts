import type { ScreenDialog } from "@exegol/shared";
import { useAgentStore } from "../stores/agents";
import { isClaudeQuestion } from "./claude-question";
import { answersPrompt } from "./dictation/target";
import { trpcInvoke } from "./trpc-client";

/** The agent shows a permission prompt or a question that an Enter would answer */
export async function agentAsksQuestion(agentId: string): Promise<boolean> {
  const { agents, attentionItems } = useAgentStore.getState();
  const agent = agents[agentId];
  if (!agent || agent.cliType === "shell") return false;
  const dialog = await trpcInvoke<ScreenDialog | null>("agents.screenDialog", {
    id: agentId,
  }).catch(() => null);
  return answersPrompt({
    status: agent.status,
    dialogOnScreen: !!dialog,
    // Claude's hooks say when it asks; other CLIs' prompts show up as a screen dialog
    awaitingAnswer: isClaudeQuestion(attentionItems[agentId], agent),
  });
}
