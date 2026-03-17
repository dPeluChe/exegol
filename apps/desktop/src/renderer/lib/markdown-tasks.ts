import { nanoid } from "nanoid";

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  depth: number;
  line: number;
}

const TASK_REGEX = /^(\s*)- \[([ x])\] (.+)$/;

export function parseMarkdownTasks(content: string): TaskItem[] {
  const lines = content.split("\n");
  const tasks: TaskItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(TASK_REGEX);
    if (match && match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      tasks.push({
        id: nanoid(),
        text: match[3],
        completed: match[2] === "x",
        depth: Math.floor(match[1].length / 2),
        line: i,
      });
    }
  }

  return tasks;
}

export function toggleTask(content: string, lineNumber: number): string {
  const lines = content.split("\n");
  const line = lines[lineNumber];
  if (!line) return content;

  const match = line.match(TASK_REGEX);
  if (!match) return content;

  const isCompleted = match[2] === "x";
  lines[lineNumber] = `${match[1]}- [${isCompleted ? " " : "x"}] ${match[3]}`;

  return lines.join("\n");
}
