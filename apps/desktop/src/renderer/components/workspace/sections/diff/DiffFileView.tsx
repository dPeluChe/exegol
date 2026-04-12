import type { DiffComment } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, FilePlus, FileX, MessageSquare, Pencil } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  useAddDiffComment,
  useDeleteDiffComment,
  useDiffComments,
  useToggleResolveDiffComment,
} from "../../../../hooks/use-trpc-diff-comments";
import { DiffHunkView } from "./DiffHunkView";
import type { DiffFile } from "./diff-parser";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".node",
  ".db",
]);

function isBinaryFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

interface DiffFileViewProps {
  file: DiffFile;
  viewMode: "unified" | "split";
  collapsed: boolean;
  onToggle: () => void;
  projectId: string | null;
}

export function DiffFileView({
  file,
  viewMode,
  collapsed,
  onToggle,
  projectId,
}: DiffFileViewProps) {
  // Fetch comments only when expanded (per-file, avoids bulk fetch)
  const { data: comments } = useDiffComments(!collapsed ? projectId : null, file.newPath);
  const addComment = useAddDiffComment();
  const deleteComment = useDeleteDiffComment();
  const toggleResolve = useToggleResolveDiffComment();

  const handleAddComment = useCallback(
    (lineNumber: number, content: string) => {
      if (!projectId) return;
      addComment.mutate({ projectId, filePath: file.newPath, lineNumber, content });
    },
    [projectId, file.newPath, addComment],
  );
  const handleDelete = useCallback((id: string) => deleteComment.mutate(id), [deleteComment]);
  const handleToggleResolve = useCallback(
    (id: string) => toggleResolve.mutate(id),
    [toggleResolve],
  );
  const additionCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "addition").length,
    0,
  );
  const deletionCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "deletion").length,
    0,
  );

  // Group comments by line number for efficient lookup
  const commentsByLine = useMemo(() => {
    if (!comments?.length) return undefined;
    const map: Record<number, DiffComment[]> = {};
    for (const c of comments) {
      const arr = map[c.lineNumber];
      if (arr) {
        arr.push(c);
      } else {
        map[c.lineNumber] = [c];
      }
    }
    return map;
  }, [comments]);

  const commentCount = comments?.length ?? 0;

  return (
    <div className="overflow-hidden rounded border border-border/50">
      {/* File header */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left",
          "bg-bg-secondary hover:bg-bg-secondary/80 transition-colors",
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        )}

        {file.isNew ? (
          <FilePlus className="h-3.5 w-3.5 shrink-0 text-green-400" />
        ) : file.isDeleted ? (
          <FileX className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : (
          <Pencil className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
        )}

        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">
          {file.newPath}
        </span>

        <span className="flex shrink-0 gap-2 text-[11px]">
          {commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-yellow-400">
              <MessageSquare className="h-3 w-3" />
              {commentCount}
            </span>
          )}
          {additionCount > 0 && <span className="text-green-400">+{additionCount}</span>}
          {deletionCount > 0 && <span className="text-red-400">-{deletionCount}</span>}
        </span>
      </button>

      {/* Hunks */}
      {!collapsed &&
        (isBinaryFile(file.newPath) ? (
          <div className="px-4 py-3 text-xs italic text-text-muted">Binary file changed</div>
        ) : (
          <div className="overflow-x-auto">
            {file.hunks.map((hunk) => (
              <DiffHunkView
                key={hunk.header}
                hunk={hunk}
                viewMode={viewMode}
                commentsByLine={commentsByLine}
                onAddComment={projectId ? handleAddComment : undefined}
                onDeleteComment={handleDelete}
                onToggleResolve={handleToggleResolve}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
