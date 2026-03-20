import { CheckSquare, Circle, Loader2 } from "lucide-react";
import type { TaskColumn } from "../../../../lib/markdown-tasks";

export const COLUMN_CONFIG: Record<
  TaskColumn,
  { label: string; color: string; icon: typeof Circle }
> = {
  backlog: { label: "Backlog", color: "text-zinc-400", icon: Circle },
  todo: { label: "Todo", color: "text-blue-400", icon: Circle },
  "in-progress": { label: "In Progress", color: "text-yellow-400", icon: Loader2 },
  validated: { label: "Validated", color: "text-purple-400", icon: CheckSquare },
  archived: { label: "Archived", color: "text-zinc-500", icon: Circle },
  done: { label: "Done", color: "text-green-400", icon: CheckSquare },
};

export const PRIORITY_COLORS: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

export const CORE_COLUMNS: TaskColumn[] = ["backlog", "todo", "in-progress", "validated", "done"];
