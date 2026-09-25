import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";
import { useState } from "react";
import { openFileInWorkspace } from "../../stores/agents";
import { FileExplorer } from "../workspace/FileExplorer";

/**
 * The project folder in the sidebar: browse, create, rename, delete, and drag
 * a file onto a terminal. A click opens the file in the workspace's Files pane.
 */
export function ProjectFiles({ projectId, path }: { projectId: string; path: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-1 py-0.5 text-left text-[9px] font-medium uppercase tracking-wider text-text-muted hover:text-text-secondary"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        <FolderTree className="h-2.5 w-2.5" />
        Files
      </button>
      {open && (
        <div className="h-72 overflow-hidden rounded-md border border-border/60">
          <FileExplorer
            rootPath={path}
            onOpenFile={(file) => openFileInWorkspace(projectId, file)}
          />
        </div>
      )}
    </div>
  );
}
