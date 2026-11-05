import type { Agent, AgentCliType, GitHubTaskRef } from "@exegol/shared";
import { showProject } from "../stores/agents";
import { focusNewPane } from "./pane-focus";
import { openInNewTab } from "./spawn-shell";
import { trpcMutate } from "./trpc-client";

/** A new session on the task, in a new tab, in its own worktree */
export async function startTaskInNewTab(
  projectId: string,
  cliType: AgentCliType,
  ref: GitHubTaskRef,
): Promise<void> {
  const { prompt, branch } = await trpcMutate<{ prompt: string; branch: string }>(
    "github.taskPrompt",
    { projectId, ...ref },
  );
  const agent = await trpcMutate<Agent>("agents.spawn", {
    projectId,
    cliType,
    taskDescription: prompt,
    useWorktree: true,
    branchName: branch,
  });
  // gh and the worktree take seconds: the tab goes in this project even if the user moved on
  showProject(projectId);
  const paneId = openInNewTab(agent);
  if (paneId) focusNewPane(paneId);
}

export function taskLabel({ kind, number, fixCi }: GitHubTaskRef): string {
  if (fixCi) return `Fix CI on #${number}`;
  return `${kind === "pr" ? "PR" : "Issue"} #${number}`;
}
