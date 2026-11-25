import { pathBase, pathBelow, pathSegments, pathSep, relPathBelow } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useFileContent } from "../../hooks/use-trpc";
import { setFileDragData } from "../../lib/file-drag";
import { trpcMutate } from "../../lib/trpc-client";
import type { FilesView, FilesViewPatch } from "../../stores/workspace";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { type ContextMenuState, FileContextMenu } from "./FileContextMenu";
import { FilePreview } from "./FilePreview";
import { RenameDialog } from "./FileRenameDialog";
import { FileSearch } from "./FileSearch";
import { DirectoryNode, type InlineCreateState } from "./FileTree";

interface FileExplorerProps {
  rootPath: string;
  /** File to show when it mounts */
  initialFile?: string;
  /** Set (a peek): a click hands the file over instead of opening the inline viewer */
  onOpenFile?: (path: string) => void;
  /** Enables the search box (project root + subrepos) */
  projectId?: string;
  /** Shown beside a terminal: an X in the header closes the panel */
  onClose?: () => void;
  /** A files pane's saved view (folders seeded from it on mount) and where its changes go */
  view?: FilesView;
  onViewChange?: (patch: FilesViewPatch) => void;
}

export function FileExplorer({
  rootPath,
  initialFile,
  onOpenFile,
  projectId,
  onClose,
  view,
  onViewChange,
}: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null);
  // The initial file's folders start open so it is visible in the tree
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const open = new Set([rootPath, ...(view?.expanded ?? [])]);
    const sep = pathSep(rootPath);
    let dir = rootPath;
    for (const part of pathSegments(pathBelow(initialFile ?? "", rootPath) ?? "").slice(0, -1)) {
      dir = `${dir}${sep}${part}`;
      open.add(dir);
    }
    return open;
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null);
  const { data: fileData, error: fileError } = useFileContent(selectedFile);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | undefined>(undefined);
  // Unsaved edits in the viewer: switching files or closing asks first
  const dirtyRef = useRef(false);
  // Marked on the root too: closing the pane asks first (lib/close-guard)
  const rootRef = useRef<HTMLDivElement>(null);
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
    rootRef.current?.setAttribute("data-unsaved", String(d));
  }, []);
  const [pendingSelect, setPendingSelect] = useState<{ path: string | null; line?: number } | null>(
    null,
  );
  const applySelect = useCallback(
    (path: string | null, line?: number) => {
      dirtyRef.current = false;
      rootRef.current?.setAttribute("data-unsaved", "false");
      setSelectedFile(path);
      setRevealLine(line);
      onViewChange?.({ openFile: path });
    },
    [onViewChange],
  );
  const requestSelect = useCallback(
    (path: string | null, line?: number) => {
      if (dirtyRef.current && path !== selectedFile) setPendingSelect({ path, line });
      else applySelect(path, line);
    },
    [selectedFile, applySelect],
  );
  const closePreview = useCallback(() => requestSelect(null), [requestSelect]);
  const pick = useCallback(
    (path: string, line?: number) => (onOpenFile ? onOpenFile(path) : requestSelect(path, line)),
    [onOpenFile, requestSelect],
  );
  const queryClient = useQueryClient();

  // T155: drag a file onto a terminal pane → pasted as @rel/path mention
  const handleFileDragStart = useCallback(
    (e: React.DragEvent, path: string) => {
      setFileDragData(e, [{ relPath: relPathBelow(path, rootPath) ?? undefined, absPath: path }]);
    },
    [rootPath],
  );

  const setExpanded = useCallback(
    (next: Set<string>) => {
      setExpandedDirs(next);
      onViewChange?.({ expanded: [...next].filter((dir) => dir !== rootPath) });
    },
    [onViewChange, rootPath],
  );

  const toggleDir = useCallback(
    (path: string) => {
      const next = new Set(expandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setExpanded(next);
    },
    [expandedDirs, setExpanded],
  );

  const startInlineCreate = useCallback(
    (parentDir: string, type: "file" | "folder") => {
      // Ensure parent dir is expanded so the inline input is visible
      setExpanded(new Set(expandedDirs).add(parentDir));
      setInlineCreate({ parentDir, type });
    },
    [expandedDirs, setExpanded],
  );

  const handleInlineCreateConfirm = useCallback(
    async (name: string) => {
      if (!inlineCreate || !name.trim()) {
        setInlineCreate(null);
        return;
      }
      const fullPath = `${inlineCreate.parentDir}/${name.trim()}`;
      try {
        await trpcMutate("files.create", { path: fullPath, type: inlineCreate.type });
        queryClient.invalidateQueries({ queryKey: ["directory"] });
      } catch (err) {
        console.error(`[FileExplorer] Failed to create ${inlineCreate.type}:`, err);
      }
      setInlineCreate(null);
    },
    [inlineCreate, queryClient],
  );

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["directory"] });
    if (selectedFile) queryClient.invalidateQueries({ queryKey: ["file", selectedFile] });
  }, [queryClient, selectedFile]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, targetPath: string, isDirectory: boolean) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, targetPath, isDirectory });
    },
    [],
  );

  const tree = (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu on tree background
    <div
      className="flex-1 overflow-auto"
      onContextMenu={(e) => handleContextMenu(e, rootPath, true)}
    >
      <div className="min-w-max py-1">
        <DirectoryNode
          path={rootPath}
          depth={0}
          onSelectFile={(path) => pick(path)}
          selectedFile={selectedFile}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onContextMenu={handleContextMenu}
          onFileDragStart={handleFileDragStart}
          inlineCreate={inlineCreate}
          onInlineConfirm={handleInlineCreateConfirm}
          onInlineCancel={() => setInlineCreate(null)}
        />
      </div>
    </div>
  );
  const treeView = projectId ? (
    <FileSearch projectId={projectId} rootPath={rootPath} onPick={pick}>
      {tree}
    </FileSearch>
  ) : (
    tree
  );

  return (
    <div ref={rootRef} className="flex h-full bg-bg-primary">
      {/* Tree view */}
      <div
        className={cn(
          "flex shrink-0 flex-col border-r border-border",
          selectedFile ? "w-[200px]" : "flex-1",
        )}
      >
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-3">
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Files
          </span>
          <button
            type="button"
            onClick={refreshAll}
            className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-secondary"
            title="Refresh"
          >
            <RefreshCw className="h-2.5 w-2.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-secondary"
              title="Close (Esc)"
              aria-label="Close files"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {treeView}
      </div>

      {/* File preview */}
      {selectedFile && (
        <FilePreview
          key={selectedFile}
          path={selectedFile}
          file={fileData}
          error={fileError}
          onClose={closePreview}
          revealLine={revealLine}
          onDirtyChange={setDirty}
          view={view}
          onViewChange={onViewChange}
        />
      )}

      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          rootPath={rootPath}
          onRequestDelete={setPendingDelete}
          onRequestRename={setRenaming}
          onStartCreate={startInlineCreate}
        />
      )}
      <RenameDialog
        path={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(from, to) => {
          if (selectedFile === from) {
            setSelectedFile(to);
            onViewChange?.({ openFile: to });
          }
          refreshAll();
        }}
      />
      <ConfirmDialog
        open={!!pendingSelect}
        onOpenChange={(open) => !open && setPendingSelect(null)}
        title="Discard unsaved changes?"
        description={`${selectedFile ? pathBase(selectedFile) : "The file"} has changes that were not saved.`}
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => pendingSelect && applySelect(pendingSelect.path, pendingSelect.line)}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete ? pathBase(pendingDelete) : ""}?`}
        description={pendingDelete ?? ""}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (!pendingDelete) return;
          trpcMutate("files.delete", { path: pendingDelete })
            .then(refreshAll)
            .catch((err) => console.error("[FileExplorer] Failed to delete:", err));
        }}
      />
    </div>
  );
}

// ─── Directory Node (controlled expansion) ─────────────────────────────────
