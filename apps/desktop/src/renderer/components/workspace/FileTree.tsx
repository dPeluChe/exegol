import { pathBase } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { type DirectoryEntry, useDirectoryListing } from "../../hooks/use-trpc";

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

export interface InlineCreateState {
  parentDir: string;
  type: "file" | "folder";
}

export function InlineInput({
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

export function DirectoryNode({
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
          <span className="truncate font-medium">{pathBase(path)}</span>
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

export function FileNode({
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
