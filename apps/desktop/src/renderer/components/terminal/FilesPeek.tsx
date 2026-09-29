import { X } from "lucide-react";
import { openFileInWorkspace } from "../../stores/agents";
import { FileExplorer } from "../workspace/FileExplorer";

/**
 * The project's files beside a terminal, for a quick look or a drag into it (a file dropped on
 * the terminal types its path), closed again with X or Esc. A click opens the file in the
 * workspace's Files pane.
 */
export function FilesPeek({
  projectId,
  rootPath,
  onClose,
}: {
  projectId: string;
  rootPath: string;
  onClose: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the panel from inside it
    <div
      className="flex w-72 shrink-0 flex-col border-l border-border bg-bg-secondary"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Files
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Close (Esc)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <FileExplorer
          rootPath={rootPath}
          projectId={projectId}
          onOpenFile={(file) => openFileInWorkspace(projectId, file)}
        />
      </div>
    </div>
  );
}
