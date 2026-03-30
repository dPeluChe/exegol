import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { type DirectoryEntry, useDirectoryListing, useFileContent } from "../../hooks/use-trpc";

// Lazy-load Monaco editor (~12MB) — only loaded when user opens a file
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

// ─── FileExplorer ──────────────────────────────────────────────────────────

interface FileExplorerProps {
  rootPath: string;
}

export function FileExplorer({ rootPath }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { data: fileData } = useFileContent(selectedFile);

  return (
    <div className="flex h-full bg-bg-primary">
      {/* Tree view — left side, scrollable both ways */}
      <div
        className={cn(
          "flex shrink-0 flex-col border-r border-border",
          selectedFile ? "w-[200px]" : "flex-1",
        )}
      >
        <div className="flex h-7 shrink-0 items-center border-b border-border bg-bg-secondary px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Files
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="min-w-max py-1">
            <DirectoryNode
              path={rootPath}
              depth={0}
              onSelectFile={setSelectedFile}
              selectedFile={selectedFile}
            />
          </div>
        </div>
      </div>

      {/* File preview — right side */}
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
    </div>
  );
}

// ─── Directory Node (lazy-loaded) ───────────────────────────────────────────

function DirectoryNode({
  path,
  depth,
  onSelectFile,
  selectedFile,
}: {
  path: string;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const { data: entries } = useDirectoryListing(expanded ? path : null);

  return (
    <>
      {depth > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
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

      {expanded &&
        entries?.map((entry) =>
          entry.isDirectory ? (
            <DirectoryNode
              key={entry.path}
              path={entry.path}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
            />
          ) : (
            <FileNode
              key={entry.path}
              entry={entry}
              depth={depth + 1}
              onSelect={onSelectFile}
              isSelected={selectedFile === entry.path}
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
}: {
  entry: DirectoryEntry;
  depth: number;
  onSelect: (path: string) => void;
  isSelected: boolean;
}) {
  const extLabel = getExtLabel(entry.name);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.path)}
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
