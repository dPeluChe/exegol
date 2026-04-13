import type { DiffComment } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { CommentCard, CommentInput } from "./DiffLineComment";
import type { DiffHunk, DiffLine } from "./diff-parser";

interface DiffHunkViewProps {
  hunk: DiffHunk;
  viewMode: "unified" | "split";
  /** Comments keyed by line number */
  commentsByLine?: Record<number, DiffComment[]>;
  onAddComment?: (lineNumber: number, content: string) => void;
  onDeleteComment?: (id: string) => void;
  onToggleResolve?: (id: string) => void;
}

export function DiffHunkView({
  hunk,
  viewMode,
  commentsByLine,
  onAddComment,
  onDeleteComment,
  onToggleResolve,
}: DiffHunkViewProps) {
  return (
    <div className="border-t border-border/50">
      {/* Hunk header */}
      <div className="bg-accent/5 px-3 py-1 font-mono text-[11px] text-accent/80">
        {hunk.header}
      </div>

      {viewMode === "unified" ? (
        <UnifiedView
          lines={hunk.lines}
          commentsByLine={commentsByLine}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          onToggleResolve={onToggleResolve}
        />
      ) : (
        <SplitView
          lines={hunk.lines}
          commentsByLine={commentsByLine}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          onToggleResolve={onToggleResolve}
        />
      )}
    </div>
  );
}

interface ViewProps {
  lines: DiffLine[];
  commentsByLine?: Record<number, DiffComment[]>;
  onAddComment?: (lineNumber: number, content: string) => void;
  onDeleteComment?: (id: string) => void;
  onToggleResolve?: (id: string) => void;
}

function UnifiedView({
  lines,
  commentsByLine,
  onAddComment,
  onDeleteComment,
  onToggleResolve,
}: ViewProps) {
  const [commentingLine, setCommentingLine] = useState<number | null>(null);

  return (
    <div className="font-mono text-[12px] leading-[18px]">
      {lines.map((line, idx) => {
        const lineNum = line.newLineNumber ?? line.oldLineNumber;
        const lineComments = lineNum != null ? commentsByLine?.[lineNum] : undefined;
        const hasCommentUI = onAddComment != null;

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines lack stable unique id
          <div key={idx}>
            <div
              className={cn(
                "group/line flex",
                line.type === "addition" && "bg-green-500/10",
                line.type === "deletion" && "bg-red-500/10",
              )}
            >
              {/* Clickable gutter for adding comments */}
              {hasCommentUI && (
                <button
                  type="button"
                  className="w-4 shrink-0 flex items-center justify-center opacity-0 group-hover/line:opacity-100 transition-opacity text-accent/50 hover:text-accent"
                  onClick={() => {
                    if (lineNum != null) {
                      setCommentingLine(commentingLine === lineNum ? null : lineNum);
                    }
                  }}
                  title="Add comment"
                >
                  {lineNum != null && <MessageSquarePlus className="h-3 w-3" />}
                </button>
              )}
              <span className="w-10 shrink-0 select-none pr-1 text-right text-text-muted/50">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-10 shrink-0 select-none pr-1 text-right text-text-muted/50">
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
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">
                {line.content}
              </span>
            </div>

            {/* Existing comments */}
            {lineComments?.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                onDelete={onDeleteComment ?? noop}
                onToggleResolve={onToggleResolve ?? noop}
              />
            ))}

            {/* Comment input */}
            {commentingLine === lineNum && lineNum != null && onAddComment && (
              <CommentInput
                onSubmit={(content) => {
                  onAddComment(lineNum, content);
                  setCommentingLine(null);
                }}
                onCancel={() => setCommentingLine(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SplitView({
  lines,
  commentsByLine,
  onAddComment,
  onDeleteComment,
  onToggleResolve,
}: ViewProps) {
  const [commentingLine, setCommentingLine] = useState<number | null>(null);

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

  const hasCommentUI = onAddComment != null;

  return (
    <div className="font-mono text-[12px] leading-[18px]">
      {left.map((leftLine, idx) => {
        const rightLine = right[idx] ?? null;
        const lineNum =
          rightLine?.newLineNumber ?? leftLine?.newLineNumber ?? leftLine?.oldLineNumber;
        const lineComments = lineNum != null ? commentsByLine?.[lineNum] : undefined;

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: split view rows lack stable unique id
          <div key={idx}>
            <div className="group/line flex">
              {/* Gutter for adding comments */}
              {hasCommentUI && (
                <button
                  type="button"
                  className="w-4 shrink-0 flex items-center justify-center opacity-0 group-hover/line:opacity-100 transition-opacity text-accent/50 hover:text-accent"
                  onClick={() => {
                    if (lineNum != null) {
                      setCommentingLine(commentingLine === lineNum ? null : lineNum);
                    }
                  }}
                  title="Add comment"
                >
                  {lineNum != null && <MessageSquarePlus className="h-3 w-3" />}
                </button>
              )}
              <SplitSide line={leftLine} side="old" />
              <div className="w-px shrink-0 bg-border/50" />
              <SplitSide line={rightLine} side="new" />
            </div>

            {/* Existing comments */}
            {lineComments?.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                onDelete={onDeleteComment ?? noop}
                onToggleResolve={onToggleResolve ?? noop}
              />
            ))}

            {/* Comment input */}
            {commentingLine === lineNum && lineNum != null && onAddComment && (
              <CommentInput
                onSubmit={(content) => {
                  onAddComment(lineNum, content);
                  setCommentingLine(null);
                }}
                onCancel={() => setCommentingLine(null)}
              />
            )}
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

function noop() {}
