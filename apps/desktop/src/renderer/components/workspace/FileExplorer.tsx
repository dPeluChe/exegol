import { cn, ScrollArea } from "@exegol/ui";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import { type DirectoryEntry, useDirectoryListing, useFileContent } from "../../hooks/use-trpc";

const EXT_LABELS: Record<string, { text: string; color: string }> = {
  ".ts": { text: "TS", color: "text-blue-400" },
  ".tsx": { text: "TX", color: "text-blue-300" },
  ".js": { text: "JS", color: "text-yellow-400" },
  ".jsx": { text: "JX", color: "text-yellow-300" },
  ".rs": { text: "RS", color: "text-orange-400" },
  ".py": { text: "PY", color: "text-green-400" },
  ".go": { text: "GO", color: "text-cyan-400" },
  ".md": { text: "MD", color: "text-zinc-400" },
  ".json": { text: "JN", color: "text-emerald-400" },
  ".toml": { text: "TL", color: "text-zinc-500" },
  ".yaml": { text: "YM", color: "text-pink-400" },
  ".yml": { text: "YM", color: "text-pink-400" },
  ".css": { text: "CS", color: "text-purple-400" },
  ".html": { text: "HT", color: "text-red-400" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function getExtLabel(name: string): { text: string; color: string } | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return EXT_LABELS[name.slice(dot)] ?? null;
}

interface FileExplorerProps {
  rootPath: string;
}

export function FileExplorer({ rootPath }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { data: fileData } = useFileContent(selectedFile);

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Tree view */}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <div className="flex h-8 shrink-0 items-center border-b border-border bg-bg-secondary px-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Files
            </span>
          </div>

          <ScrollArea className="flex-1">
            <div className="py-1">
              <DirectoryNode path={rootPath} depth={0} onSelectFile={setSelectedFile} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* File preview */}
      {selectedFile && fileData && (
        <div className="flex max-h-[40%] flex-col border-t border-border">
          <div className="flex h-7 shrink-0 items-center justify-between bg-bg-secondary px-3">
            <span className="truncate text-[10px] text-text-muted">{selectedFile}</span>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-[10px] text-text-muted hover:text-text-primary"
            >
              Close
            </button>
          </div>
          <ScrollArea className="flex-1">
            <pre className="p-3 text-[11px] leading-relaxed text-text-secondary">
              <code>{fileData.content.slice(0, 5000)}</code>
            </pre>
          </ScrollArea>
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
}: {
  path: string;
  depth: number;
  onSelectFile: (path: string) => void;
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
            />
          ) : (
            <FileNode key={entry.path} entry={entry} depth={depth + 1} onSelect={onSelectFile} />
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
}: {
  entry: DirectoryEntry;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const extLabel = getExtLabel(entry.name);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.path)}
      className="flex w-full items-center gap-1 px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
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
