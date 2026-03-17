import { cn } from "@exegol/ui";
import type { DiffHunk, DiffLine } from "./diff-parser";

interface DiffHunkViewProps {
  hunk: DiffHunk;
  viewMode: "unified" | "split";
}

export function DiffHunkView({ hunk, viewMode }: DiffHunkViewProps) {
  return (
    <div className="border-t border-border/50">
      {/* Hunk header */}
      <div className="bg-accent/5 px-3 py-1 font-mono text-[11px] text-accent/80">
        {hunk.header}
      </div>

      {viewMode === "unified" ? (
        <UnifiedView lines={hunk.lines} />
      ) : (
        <SplitView lines={hunk.lines} />
      )}
    </div>
  );
}

function UnifiedView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="font-mono text-[12px] leading-[18px]">
      {lines.map((line, idx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines lack stable unique id
          key={idx}
          className={cn(
            "flex",
            line.type === "addition" && "bg-green-500/10",
            line.type === "deletion" && "bg-red-500/10",
          )}
        >
          <span className="w-12 shrink-0 select-none pr-1 text-right text-text-muted/50">
            {line.oldLineNumber ?? ""}
          </span>
          <span className="w-12 shrink-0 select-none pr-1 text-right text-text-muted/50">
            {line.newLineNumber ?? ""}
          </span>
          <span
            className={cn(
              "w-4 shrink-0 select-none text-center",
              line.type === "addition" && "text-green-400",
              line.type === "deletion" && "text-red-400",
            )}
          >
            {line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " "}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{line.content}</span>
        </div>
      ))}
    </div>
  );
}

function SplitView({ lines }: { lines: DiffLine[] }) {
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    if (line.type === "context") {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === "deletion") {
      const deletions: DiffLine[] = [];
      while (i < lines.length && lines[i]?.type === "deletion") {
        const del = lines[i];
        if (del) deletions.push(del);
        i++;
      }
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i]?.type === "addition") {
        const add = lines[i];
        if (add) additions.push(add);
        i++;
      }
      const maxLen = Math.max(deletions.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        left.push(j < deletions.length ? (deletions[j] ?? null) : null);
        right.push(j < additions.length ? (additions[j] ?? null) : null);
      }
    } else if (line.type === "addition") {
      left.push(null);
      right.push(line);
      i++;
    } else {
      i++;
    }
  }

  return (
    <div className="font-mono text-[12px] leading-[18px]">
      {left.map((leftLine, idx) => {
        const rightLine = right[idx] ?? null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: split view rows lack stable unique id
          <div key={idx} className="flex">
            <SplitSide line={leftLine} side="old" />
            <div className="w-px shrink-0 bg-border/50" />
            <SplitSide line={rightLine} side="new" />
          </div>
        );
      })}
    </div>
  );
}

function SplitSide({ line, side }: { line: DiffLine | null; side: "old" | "new" }) {
  const lineNum = side === "old" ? line?.oldLineNumber : line?.newLineNumber;
  return (
    <div
      className={cn(
        "flex flex-1 min-w-0",
        line?.type === "addition" && "bg-green-500/10",
        line?.type === "deletion" && "bg-red-500/10",
        !line && "bg-bg-secondary/50",
      )}
    >
      <span className="w-10 shrink-0 select-none pr-1 text-right text-text-muted/50">
        {lineNum ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          line?.type === "addition" && "text-green-400",
          line?.type === "deletion" && "text-red-400",
        )}
      >
        {line?.type === "addition" ? "+" : line?.type === "deletion" ? "-" : line ? " " : ""}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">
        {line?.content ?? ""}
      </span>
    </div>
  );
}
