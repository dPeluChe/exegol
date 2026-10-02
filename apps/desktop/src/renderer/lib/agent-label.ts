import type { AgentState } from "../stores/agents";

/** A session's name: its alias, else the task or folder it was opened with (a quick launch's
 *  task is only the CLI's name, so that one falls back to the CLI) */
export function sessionName(agent: Pick<AgentState, "alias" | "taskDescription" | "cliType">) {
  return (
    agent.alias ??
    (agent.taskDescription && agent.taskDescription !== agent.cliType
      ? agent.taskDescription.slice(0, 40)
      : agent.cliType)
  );
}
