/**
 * Enhanced markdown task parser for kanban-style task management.
 *
 * Parses TODO.md with section headings as columns:
 *   ## Backlog / ## Todo / ## In Progress / ## Validated / ## Archived / ## Done
 *
 * Task format:
 *   - [ ] Task description #tag1 #tag2 @agent-name
 *   - [x] Completed task #done
 *
 * The .md file is always the source of truth. All mutations write back to the file.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskColumn = "backlog" | "todo" | "in-progress" | "validated" | "archived" | "done";

export interface TaskItem {
  /** Unique ID (stable per parse — based on line number) */
  id: string;
  /** Raw text without checkbox, tags, or agent */
  text: string;
  /** Whether the checkbox is checked */
  completed: boolean;
  /** Nesting depth (0 = top level) */
  depth: number;
  /** Line number in the source file (0-indexed) */
  line: number;
  /** Column determined by the heading above this task */
  column: TaskColumn;
  /** Tags extracted from #tag syntax */
  tags: string[];
  /** Assigned agent CLI type (from @agent syntax) */
  assignedAgent: string | null;
  /** Priority extracted from !high, !medium, !low or !! !!! syntax */
  priority: "high" | "medium" | "low" | null;
}

export interface TaskBoard {
  /** All tasks grouped by column */
  columns: Record<TaskColumn, TaskItem[]>;
  /** Column order as they appear in the file */
  columnOrder: TaskColumn[];
  /** Raw file content (for mutations) */
  rawContent: string;
  /** File path */
  filePath: string;
}

// ─── Column detection ───────────────────────────────────────────────────────

const COLUMN_MAP: Record<string, TaskColumn> = {
  backlog: "backlog",
  "to do": "todo",
  todo: "todo",
  "to-do": "todo",
  "in progress": "in-progress",
  "in-progress": "in-progress",
  inprogress: "in-progress",
  wip: "in-progress",
  working: "in-progress",
  validated: "validated",
  review: "validated",
  "in review": "validated",
  archived: "archived",
  archive: "archived",
  done: "done",
  completed: "done",
  finished: "done",
};

function detectColumn(heading: string): TaskColumn | null {
  const normalized = heading.toLowerCase().trim();
  return COLUMN_MAP[normalized] ?? null;
}

// ─── Task line parsing ──────────────────────────────────────────────────────

const TASK_REGEX = /^(\s*)- \[([ xX])\] (.+)$/;
const TAG_REGEX = /#([\w-]+)/g;
const AGENT_REGEX = /@([\w-]+)/;
const PRIORITY_REGEX = /!(high|medium|low|!!+)/i;

function extractTags(text: string): string[] {
  const tags: string[] = [];
  let match: RegExpExecArray | null = null;
  TAG_REGEX.lastIndex = 0;
  match = TAG_REGEX.exec(text);
  while (match) {
    tags.push(match[1] as string);
    match = TAG_REGEX.exec(text);
  }
  return tags;
}

function extractAgent(text: string): string | null {
  const match = text.match(AGENT_REGEX);
  return match?.[1] ?? null;
}

function extractPriority(text: string): "high" | "medium" | "low" | null {
  const match = text.match(PRIORITY_REGEX);
  if (!match?.[1]) return null;
  const val = match[1].toLowerCase();
  if (val === "high" || val.startsWith("!!!")) return "high";
  if (val === "medium" || val === "!!") return "medium";
  if (val === "low" || val === "!") return "low";
  return null;
}

function cleanTaskText(text: string): string {
  return text
    .replace(TAG_REGEX, "")
    .replace(AGENT_REGEX, "")
    .replace(PRIORITY_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Main parser ────────────────────────────────────────────────────────────

export function parseTaskBoard(content: string, filePath: string): TaskBoard {
  const lines = content.split("\n");
  const columns: Record<TaskColumn, TaskItem[]> = {
    backlog: [],
    todo: [],
    "in-progress": [],
    validated: [],
    archived: [],
    done: [],
  };
  const columnOrder: TaskColumn[] = [];
  let currentColumn: TaskColumn = "backlog";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Detect heading → column
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch?.[1]) {
      const col = detectColumn(headingMatch[1]);
      if (col) {
        currentColumn = col;
        if (!columnOrder.includes(col)) {
          columnOrder.push(col);
        }
      }
      continue;
    }

    // Detect task line
    const taskMatch = line.match(TASK_REGEX);
    if (taskMatch?.[1] !== undefined && taskMatch[2] !== undefined && taskMatch[3] !== undefined) {
      const rawText = taskMatch[3];
      const completed = taskMatch[2].toLowerCase() === "x";
      const tags = extractTags(rawText);
      const assignedAgent = extractAgent(rawText);
      const priority = extractPriority(rawText);
      const text = cleanTaskText(rawText);

      // Keep tasks in their file section — don't auto-move based on checkbox
      const task: TaskItem = {
        id: `task-${i}`,
        text,
        completed,
        depth: Math.floor(taskMatch[1].length / 2),
        line: i,
        column: currentColumn,
        tags,
        assignedAgent,
        priority,
      };

      columns[currentColumn].push(task);
    }
  }

  // If no columns were detected from headings, use backlog as default
  if (columnOrder.length === 0) {
    columnOrder.push("backlog");
    if (columns.done.length > 0) columnOrder.push("done");
  }

  return { columns, columnOrder, rawContent: content, filePath };
}

// ─── Mutations (write back to .md) ──────────────────────────────────────────

/** Toggle a task's checkbox */
export function toggleTask(content: string, lineNumber: number): string {
  const lines = content.split("\n");
  const line = lines[lineNumber];
  if (!line) return content;

  const match = line.match(TASK_REGEX);
  if (!match?.[3]) return content;

  const isCompleted = match[2]?.toLowerCase() === "x";
  lines[lineNumber] = `${match[1]}- [${isCompleted ? " " : "x"}] ${match[3]}`;
  return lines.join("\n");
}

/** Move a task from one column to another by rewriting the file */
export function moveTask(content: string, taskLine: number, targetColumn: TaskColumn): string {
  const lines = content.split("\n");
  const taskLineContent = lines[taskLine];
  if (!taskLineContent) return content;

  const match = taskLineContent.match(TASK_REGEX);
  if (!match) return content;

  // Remove task from current position
  lines.splice(taskLine, 1);

  // Find the target column heading
  const columnHeadings: Record<TaskColumn, string> = {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In Progress",
    validated: "Validated",
    archived: "Archived",
    done: "Done",
  };

  const targetHeading = columnHeadings[targetColumn];
  let targetIndex = -1;

  // Find the heading line
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]?.match(/^#{1,3}\s+(.+)$/);
    if (heading?.[1] && detectColumn(heading[1]) === targetColumn) {
      targetIndex = i;
      break;
    }
  }

  // If heading not found, create it at the end
  if (targetIndex === -1) {
    lines.push("", `## ${targetHeading}`);
    targetIndex = lines.length - 1;
  }

  // Find the last task under the target heading (or right after the heading)
  let insertAt = targetIndex + 1;
  for (let i = targetIndex + 1; i < lines.length; i++) {
    const nextLine = lines[i] ?? "";
    // Stop at next heading
    if (/^#{1,3}\s+/.test(nextLine)) break;
    // Skip empty lines and task lines
    if (nextLine.trim() === "" || TASK_REGEX.test(nextLine)) {
      insertAt = i + 1;
    }
  }

  // Update checkbox based on target column
  let updatedTask = taskLineContent;
  if (targetColumn === "done" || targetColumn === "archived") {
    updatedTask = updatedTask.replace(/- \[ \]/, "- [x]");
  } else if (targetColumn === "backlog" || targetColumn === "todo") {
    updatedTask = updatedTask.replace(/- \[x\]/i, "- [ ]");
  }

  lines.splice(insertAt, 0, updatedTask);
  return lines.join("\n");
}

/** Assign an agent to a task by adding @agent-name */
export function assignAgent(content: string, taskLine: number, agentId: string): string {
  const lines = content.split("\n");
  const line = lines[taskLine];
  if (!line) return content;

  // Remove existing @agent if present
  let updated = line
    .replace(AGENT_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd();
  // Append new agent
  updated = `${updated} @${agentId}`;
  lines[taskLine] = updated;
  return lines.join("\n");
}

/** Add a new task to a specific column */
export function addTask(
  content: string,
  text: string,
  column: TaskColumn,
  tags: string[] = [],
): string {
  const lines = content.split("\n");
  const tagStr = tags.length > 0 ? ` ${tags.map((t) => `#${t}`).join(" ")}` : "";
  const newLine = `- [ ] ${text}${tagStr}`;

  const columnHeadings: Record<TaskColumn, string> = {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In Progress",
    validated: "Validated",
    archived: "Archived",
    done: "Done",
  };

  // Find the column heading
  let targetIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]?.match(/^#{1,3}\s+(.+)$/);
    if (heading?.[1] && detectColumn(heading[1]) === column) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    // Column doesn't exist — create it
    lines.push("", `## ${columnHeadings[column]}`, newLine);
  } else {
    // Insert after heading
    lines.splice(targetIndex + 1, 0, newLine);
  }

  return lines.join("\n");
}

/** Remove a task from the file */
export function removeTask(content: string, taskLine: number): string {
  const lines = content.split("\n");
  if (taskLine >= 0 && taskLine < lines.length) {
    lines.splice(taskLine, 1);
  }
  return lines.join("\n");
}

// ─── Legacy compat (used by old TasksSection) ───────────────────────────────

export type { TaskItem as LegacyTaskItem };

export function parseMarkdownTasks(content: string): TaskItem[] {
  const board = parseTaskBoard(content, "");
  return Object.values(board.columns).flat();
}
