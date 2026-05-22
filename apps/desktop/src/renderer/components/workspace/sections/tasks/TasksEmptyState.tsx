import { Button } from "@exegol/ui";
import { CheckSquare, FolderOpen, Plus } from "lucide-react";
import { EmptyState } from "../../../common/EmptyState";

interface TasksEmptyStateProps {
  onCreateTodo: () => void;
  onPickFile: () => void;
}

export function TasksEmptyState({ onCreateTodo, onPickFile }: TasksEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <EmptyState
        icon={<CheckSquare className="h-8 w-8 text-text-muted" />}
        title="No task file found"
        description="Create a TODO.md or open an existing one"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onCreateTodo}
          className="gap-1.5 bg-accent text-white hover:bg-accent/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Create TODO.md
        </Button>
        <Button
          type="button"
          onClick={onPickFile}
          className="gap-1.5 bg-bg-tertiary text-text-secondary hover:text-text-primary"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open Existing
        </Button>
      </div>
    </div>
  );
}
