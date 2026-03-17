import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, FilePlus, FileX, Pencil } from "lucide-react";
import { useState } from "react";
import { DiffHunkView } from "./DiffHunkView";
import type { DiffFile } from "./diff-parser";

interface DiffFileViewProps {
  file: DiffFile;
  viewMode: "unified" | "split";
}

export function DiffFileView({ file, viewMode }: DiffFileViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  const additionCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "addition").length,
    0,
  );
  const deletionCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "deletion").length,
    0,
  );

  return (
    <div className="overflow-hidden rounded border border-border/50">
      {/* File header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
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
          {additionCount > 0 && <span className="text-green-400">+{additionCount}</span>}
          {deletionCount > 0 && <span className="text-red-400">-{deletionCount}</span>}
        </span>
      </button>

      {/* Hunks */}
      {!collapsed && (
        <div className="overflow-x-auto">
          {file.hunks.map((hunk) => (
            <DiffHunkView key={hunk.header} hunk={hunk} viewMode={viewMode} />
          ))}
        </div>
      )}
    </div>
  );
}
