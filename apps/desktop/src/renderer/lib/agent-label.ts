import type { AgentState } from "../stores/agents";

export const OTHER_PROJECT = "another project";

/** Grouped by project, in first-seen order */
export function byProject<T extends { projectId: string }>(list: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const s of list) groups.set(s.projectId, [...(groups.get(s.projectId) ?? []), s]);
  return groups;
}

/** "name · project", so a line about a session says where it is */
export function sessionWhere(
  agent: Pick<AgentState, "alias" | "taskDescription" | "cliType" | "projectId">,
  projects: { id: string; name: string }[],
): string {
  const project = projects.find((p) => p.id === agent.projectId)?.name ?? OTHER_PROJECT;
  return `${sessionName(agent)} · ${project}`;
}

/** A session's name: its alias, else the task or folder it was opened with (a quick launch's
 *  task is only the CLI's name, so that one falls back to the CLI) */
export function sessionName(agent: {
  alias?: string | null;
  taskDescription?: string | null;
  cliType: string;
}) {
  return (
    agent.alias ??
    (agent.taskDescription && agent.taskDescription !== agent.cliType
      ? agent.taskDescription.slice(0, 40)
      : agent.cliType)
  );
}
