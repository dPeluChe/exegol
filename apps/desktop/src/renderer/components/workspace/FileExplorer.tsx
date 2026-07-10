import { cn } from "@exegol/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { type DirectoryEntry, useDirectoryListing, useFileContent } from "../../hooks/use-trpc";
import { setFileDragData } from "../../lib/file-drag";
import { trpcMutate } from "../../lib/trpc-client";

const CodeViewer = lazy(() => import("./CodeViewer").then((m) => ({ default: m.CodeViewer })));

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
  onClose,
  onRefresh,
  onStartCreate,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onRefresh: () => void;
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

  const handleDelete = useCallback(async () => {
    const name = menu.targetPath.split("/").pop();
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await trpcMutate("files.delete", { path: menu.targetPath });
      onRefresh();
    } catch (err) {
      console.error("[FileExplorer] Failed to delete:", err);
    }
    onClose();
  }, [menu, onClose, onRefresh]);

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
}

interface InlineCreateState {
  parentDir: string;
  type: "file" | "folder";
}

export function FileExplorer({ rootPath }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set([rootPath]));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null);
  const { data: fileData } = useFileContent(selectedFile);
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: context menu on tree background */}
        <div
          className="flex-1 overflow-auto"
          onContextMenu={(e) => handleContextMenu(e, rootPath, true)}
        >
          <div className="min-w-max py-1">
            <DirectoryNode
              path={rootPath}
              depth={0}
              onSelectFile={setSelectedFile}
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
      </div>

      {/* File preview */}
      {selectedFile && fileData && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-3">
            <span className="truncate text-[10px] text-text-secondary">
              {selectedFile.split("/").pop()}
            </span>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="shrink-0 text-[10px] text-text-muted hover:text-text-primary"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-text-muted">
                  Loading editor...
                </div>
              }
            >
              <CodeViewer content={fileData.content} fileName={selectedFile} />
            </Suspense>
          </div>
        </div>
      )}

      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRefresh={refreshAll}
          onStartCreate={startInlineCreate}
        />
      )}
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
  const { data: entries } = useDirectoryListing(expanded ? path : null);
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
