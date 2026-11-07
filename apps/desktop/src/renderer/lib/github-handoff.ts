import type { Agent, AgentCliType, AgentProvider, GitHubTaskRef } from "@exegol/shared";
import { showProject } from "../stores/agents";
import { focusNewPane } from "./pane-focus";
import { openInNewTab } from "./spawn-shell";
import { trpcMutate } from "./trpc-client";

// A provider that cannot take a prompt at launch would start without the task
export const takesPrompt = (p: AgentProvider) => p.capabilities.supportsPromptArg;

/** A new session on the task, in a new tab, in its own worktree */
export async function startTaskInNewTab(
  projectId: string,
  cliType: AgentCliType,
  ref: GitHubTaskRef,
): Promise<void> {
  const { prompt, branch, worktreeRepo } = await trpcMutate<{
    prompt: string;
    branch: string;
    worktreeRepo?: string;
  }>("github.taskPrompt", { projectId, ...ref });
  await startInNewTab(projectId, cliType, {
    taskDescription: prompt,
    useWorktree: true,
    branchName: branch,
    worktreeRepo,
  });
}

/** A prompt at launch, so `cliType` must take one */
export async function startInNewTab(
  projectId: string,
  cliType: AgentCliType,
  spawn: {
    taskDescription: string;
    useWorktree: boolean;
    branchName: string;
    worktreeRepo?: string;
  },
): Promise<void> {
  const agent = await trpcMutate<Agent>("agents.spawn", { projectId, cliType, ...spawn });
  // gh and the worktree take seconds: the tab goes in this project even if the user moved on
  showProject(projectId);
  const paneId = openInNewTab(agent);
  if (paneId) focusNewPane(paneId);
}

export function taskLabel({ kind, number, fixCi, repo }: GitHubTaskRef): string {
  const name = repo.folder ? `${repo.folder} ` : "";
  if (fixCi) return `Fix CI on ${name}#${number}`;
  return `${name}${kind === "pr" ? "PR" : "Issue"} #${number}`;
}
