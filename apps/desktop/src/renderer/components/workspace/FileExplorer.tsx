import { cn } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DirectoryEntry, useDirectoryListing, useFileContent } from "../../hooks/use-trpc";
import { setFileDragData } from "../../lib/file-drag";
import { trpcMutate } from "../../lib/trpc-client";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { FilePreview } from "./FilePreview";
import { FileSearch } from "./FileSearch";

// ─── Extension Labels ────────────────────────────────────────────────────────

const EXT_LABELS: Record<string, { text: string; color: string }> = {
  ".ts": { text: "TS", color: "text-blue-400" },
  ".tsx": { text: "TX", color: "text-blue-300" },
  ".js": { text: "JS", color: "text-yellow-400" },
  ".jsx": { text: "JX", color: "text-yellow-300" },
  ".rs": { text: "RS", color: "text-orange-400" },
  ".py": { text: "PY", color: "text-green-400" },
  ".go": { text: "GO", color: "text-cyan-400" },
  ".md": { text: "MD", color: "text-gray-400" },
  ".json": { text: "JN", color: "text-lime-400" },
  ".css": { text: "CS", color: "text-pink-400" },
  ".html": { text: "HT", color: "text-red-400" },
  ".toml": { text: "TL", color: "text-zinc-400" },
  ".yaml": { text: "YM", color: "text-amber-400" },
  ".yml": { text: "YM", color: "text-amber-400" },
};

function getExtLabel(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return EXT_LABELS[name.slice(dot)] ?? null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ─── Context Menu ──────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  isDirectory: boolean;
}

function FileContextMenu({
  menu,
  rootPath,
  onClose,
  onRequestDelete,
  onRequestRename,
  onStartCreate,
}: {
  menu: ContextMenuState;
  rootPath: string;
  onClose: () => void;
  onRequestDelete: (path: string) => void;
  onRequestRename: (path: string) => void;
  onStartCreate: (parentDir: string, type: "file" | "folder") => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleCreate = useCallback(
    (type: "file" | "folder") => {
      const parentDir = menu.isDirectory
        ? menu.targetPath
        : menu.targetPath.replace(/\/[^/]+$/, "");
      onClose();
      onStartCreate(parentDir, type);
    },
    [menu, onClose, onStartCreate],
  );

  // The explorer asks (a blocking window.confirm froze the renderer's IPC)
  const handleDelete = useCallback(() => {
    onRequestDelete(menu.targetPath);
    onClose();
  }, [menu, onClose, onRequestDelete]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-md border py-1 shadow-xl"
      style={{
        left: menu.x,
        top: menu.y,
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      {(
        [
          [
            "Open with default app",
            ExternalLink,
            () => trpcMutate("files.openExternal", { path: menu.targetPath }),
          ],
          [
            "Reveal in Finder",
            FolderSearch,
            () => trpcMutate("files.reveal", { path: menu.targetPath }),
          ],
          ["Copy path", Copy, () => navigator.clipboard.writeText(menu.targetPath)],
          [
            "Copy relative path",
            Copy,
            () =>
              navigator.clipboard.writeText(
                menu.targetPath.slice(rootPath.length).replace(/^\//, ""),
              ),
          ],
          ["Rename", Pencil, () => onRequestRename(menu.targetPath)],
        ] as const
      ).map(([label, Icon, run]) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            onClose();
            Promise.resolve(run()).catch((err) =>
              console.error(`[FileExplorer] ${label} failed:`, err),
            );
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
      <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
      <button
        type="button"
        onClick={() => handleCreate("file")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
      >
        <FilePlus className="h-3.5 w-3.5" /> New File
      </button>
      <button
        type="button"
        onClick={() => handleCreate("folder")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/10"
      >
        <FolderPlus className="h-3.5 w-3.5" /> New Folder
      </button>
      <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
      <button
        type="button"
        onClick={handleDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-white/10"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>
  );
}

// ─── FileExplorer ──────────────────────────────────────────────────────────

interface FileExplorerProps {
  rootPath: string;
  /** File to show when it mounts */
  initialFile?: string;
  /** Set (the sidebar): a click hands the file over instead of opening the inline viewer */
  onOpenFile?: (path: string) => void;
  /** Enables the search box (project root + subrepos) */
  projectId?: string;
}

interface InlineCreateState {
  parentDir: string;
  type: "file" | "folder";
}

export function FileExplorer({ rootPath, initialFile, onOpenFile, projectId }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null);
  // The initial file's folders start open so it is visible in the tree
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const open = new Set([rootPath]);
    if (initialFile?.startsWith(`${rootPath}/`)) {
      const parts = initialFile
        .slice(rootPath.length + 1)
        .split("/")
        .slice(0, -1);
      let dir = rootPath;
      for (const part of parts) {
        dir = `${dir}/${part}`;
        open.add(dir);
      }
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
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  const [pendingSelect, setPendingSelect] = useState<{ path: string | null; line?: number } | null>(
    null,
  );
  const applySelect = useCallback((path: string | null, line?: number) => {
    dirtyRef.current = false;
    setSelectedFile(path);
    setRevealLine(line);
  }, []);
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
      const relPath = path.startsWith(rootPath)
        ? path.slice(rootPath.length).replace(/^\//, "")
        : undefined;
      setFileDragData(e, [{ relPath, absPath: path }]);
    },
    [rootPath],
  );

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const startInlineCreate = useCallback((parentDir: string, type: "file" | "folder") => {
    // Ensure parent dir is expanded so the inline input is visible
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.add(parentDir);
      return next;
    });
    setInlineCreate({ parentDir, type });
  }, []);

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
    <div className="flex h-full bg-bg-primary">
      {/* Tree view */}
      <div
        className={cn(
          "flex shrink-0 flex-col border-r border-border",
          selectedFile ? "w-[200px]" : "flex-1",
        )}
      >
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
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
          if (selectedFile === from) setSelectedFile(to);
          refreshAll();
        }}
      />
      <ConfirmDialog
        open={!!pendingSelect}
        onOpenChange={(open) => !open && setPendingSelect(null)}
        title="Discard unsaved changes?"
        description={`${selectedFile?.split("/").pop() ?? "The file"} has changes that were not saved.`}
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => pendingSelect && applySelect(pendingSelect.path, pendingSelect.line)}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.split("/").pop() ?? ""}?`}
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

function InlineInput({
  depth,
  type,
  onConfirm,
  onCancel,
}: {
  depth: number;
  type: "file" | "folder";
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handledRef = useRef(false);

  const submit = useCallback(
    (value: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      if (value.trim()) onConfirm(value);
      else onCancel();
    },
    [onConfirm, onCancel],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {type === "folder" ? (
        <FolderPlus className="h-3.5 w-3.5 shrink-0 text-accent" />
      ) : (
        <FilePlus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={`New ${type}...`}
        className="flex-1 rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-primary outline-none ring-1 ring-accent/50"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") {
            handledRef.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => submit(e.target.value)}
      />
    </div>
  );
}

function DirectoryNode({
  path,
  depth,
  onSelectFile,
  selectedFile,
  expandedDirs,
  onToggleDir,
  onContextMenu,
  onFileDragStart,
  inlineCreate,
  onInlineConfirm,
  onInlineCancel,
}: {
  path: string;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onFileDragStart: (e: React.DragEvent, path: string) => void;
  inlineCreate: InlineCreateState | null;
  onInlineConfirm: (name: string) => void;
  onInlineCancel: () => void;
}) {
  const expanded = expandedDirs.has(path);
  const { data: entries, error } = useDirectoryListing(expanded ? path : null);
  const showInlineInput = inlineCreate?.parentDir === path;

  return (
    <>
      {depth > 0 && (
        <button
          type="button"
          onClick={() => onToggleDir(path)}
          onContextMenu={(e) => {
            e.stopPropagation();
            onContextMenu(e, path, true);
          }}
          className="flex w-full items-center gap-1 px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-white/5"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          )}
          <span className="truncate font-medium">{path.split("/").pop()}</span>
        </button>
      )}
      {/* It failed silently: an unreadable root left the whole pane blank */}
      {expanded && error && (
        <p
          className="px-2 py-1 text-[10px] text-red-400"
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
        >
          Cannot list {path}: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {showInlineInput && (
        <InlineInput
          depth={depth + 1}
          type={inlineCreate.type}
          onConfirm={onInlineConfirm}
          onCancel={onInlineCancel}
        />
      )}

      {expanded &&
        entries?.map((entry) =>
          entry.isDirectory ? (
            <DirectoryNode
              key={entry.path}
              path={entry.path}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onContextMenu={onContextMenu}
              onFileDragStart={onFileDragStart}
              inlineCreate={inlineCreate}
              onInlineConfirm={onInlineConfirm}
              onInlineCancel={onInlineCancel}
            />
          ) : (
            <FileNode
              key={entry.path}
              entry={entry}
              depth={depth + 1}
              onSelect={onSelectFile}
              isSelected={selectedFile === entry.path}
              onContextMenu={onContextMenu}
              onFileDragStart={onFileDragStart}
            />
          ),
        )}
    </>
  );
}

// ─── File Node ──────────────────────────────────────────────────────────────

function FileNode({
  entry,
  depth,
  onSelect,
  isSelected,
  onContextMenu,
  onFileDragStart,
}: {
  entry: DirectoryEntry;
  depth: number;
  onSelect: (path: string) => void;
  isSelected: boolean;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onFileDragStart: (e: React.DragEvent, path: string) => void;
}) {
  const extLabel = getExtLabel(entry.name);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => onFileDragStart(e, entry.path)}
      onClick={() => onSelect(entry.path)}
      onContextMenu={(e) => {
        e.stopPropagation();
        onContextMenu(e, entry.path, false);
      }}
      className={cn(
        "flex w-full items-center gap-1 px-2 py-0.5 text-[11px] transition-colors",
        isSelected
          ? "bg-accent/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {extLabel ? (
        <span className={cn("w-4 shrink-0 text-center text-[8px] font-bold", extLabel.color)}>
          {extLabel.text}
        </span>
      ) : (
        <File className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{entry.name}</span>
      <span className="ml-auto shrink-0 text-[9px] text-text-muted/60">
        {formatSize(entry.size)}
      </span>
    </button>
  );
}

/** Rename in place (Electron has no window.prompt) */
function RenameDialog({
  path,
  onClose,
  onRenamed,
}: {
  path: string | null;
  onClose: () => void;
  onRenamed: (from: string, to: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = path?.split("/").pop() ?? "";
  const dir = path ? path.slice(0, path.length - current.length) : "";

  const submit = async () => {
    const next = name.trim();
    if (!path || !next || next === current || next.includes("/")) return onClose();
    try {
      await trpcMutate("files.rename", { from: path, to: `${dir}${next}` });
      onRenamed(path, `${dir}${next}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog.Root
      open={!!path}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/3 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border p-4 shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          onOpenAutoFocus={() => {
            setName(current);
            setError(null);
          }}
        >
          <Dialog.Title className="mb-2 text-sm font-semibold text-text-primary">
            Rename {current}
          </Dialog.Title>
          <input
            // biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
          />
          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
