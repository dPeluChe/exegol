import type { GitHubIssue } from "@exegol/shared";
import type { TaskColumn, TaskItem } from "./markdown-tasks";

/**
 * Map GitHub issues to TaskItem[] for display in the Kanban board.
 *
 * Column mapping:
 *  - closed issues → "done"
 *  - open issues with "in progress" or "wip" label → "in-progress"
 *  - all other open issues → "todo"
 */
export function mapIssuesToTasks(issues: GitHubIssue[]): TaskItem[] {
  return issues.map((issue) => {
    const labelsLower = issue.labels.map((l) => l.toLowerCase());
    let column: TaskColumn;

    if (issue.state === "closed") {
      column = "done";
    } else if (
      labelsLower.includes("in progress") ||
      labelsLower.includes("in-progress") ||
      labelsLower.includes("wip")
    ) {
      column = "in-progress";
    } else {
      column = "todo";
    }

    return {
      id: `gh-${issue.number}`,
      text: issue.title,
      completed: issue.state === "closed",
      depth: 0,
      line: -1, // Not from a file
      column,
      tags: issue.labels,
      assignedAgent: null,
      priority: null,
      source: "github",
      issueNumber: issue.number,
      issueUrl: issue.url,
      issueBody: issue.body,
      issueAssignees: issue.assignees,
    };
  });
}
