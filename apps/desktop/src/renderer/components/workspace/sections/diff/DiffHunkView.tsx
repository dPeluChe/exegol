import type { DiffComment } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { CommentCard, CommentInput } from "./DiffLineComment";
import type { DiffHunk, DiffLine, ViewMode } from "./diff-parser";
import { pairSplitRows } from "./split-rows";

interface DiffHunkViewProps {
  hunk: DiffHunk;
  viewMode: ViewMode;
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
      {lines.map((line) => {
        const lineNum = line.newLineNumber ?? line.oldLineNumber;
        const hasCommentUI = onAddComment != null;

        return (
          <div key={`${line.type}:${line.oldLineNumber ?? ""}:${line.newLineNumber ?? ""}`}>
            <div
              className={cn(
                "group/line flex",
                line.type === "addition" && "bg-green-500/10",
                line.type === "deletion" && "bg-red-500/10",
              )}
            >
              {/* Clickable gutter for adding comments */}
              {hasCommentUI && (
                <CommentGutter
                  lineNum={lineNum}
                  commentingLine={commentingLine}
                  onCommentingLineChange={setCommentingLine}
                />
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

            <LineCommentThread
              lineNum={lineNum}
              commentsByLine={commentsByLine}
              commentingLine={commentingLine}
              onCommentingLineChange={setCommentingLine}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              onToggleResolve={onToggleResolve}
            />
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
  const rows = pairSplitRows(lines);
  const hasCommentUI = onAddComment != null;

  return (
    <div className="font-mono text-[12px] leading-[18px]">
      {rows.map(({ left: leftLine, right: rightLine }) => {
        const lineNum =
          rightLine?.newLineNumber ?? leftLine?.newLineNumber ?? leftLine?.oldLineNumber;

        return (
          <div key={`${leftLine?.oldLineNumber ?? ""}:${rightLine?.newLineNumber ?? ""}`}>
            <div className="group/line flex">
              {/* Gutter for adding comments */}
              {hasCommentUI && (
                <CommentGutter
                  lineNum={lineNum}
                  commentingLine={commentingLine}
                  onCommentingLineChange={setCommentingLine}
                />
              )}
              <SplitSide line={leftLine} side="old" />
              <div className="w-px shrink-0 bg-border/50" />
              <SplitSide line={rightLine} side="new" />
            </div>

            <LineCommentThread
              lineNum={lineNum}
              commentsByLine={commentsByLine}
              commentingLine={commentingLine}
              onCommentingLineChange={setCommentingLine}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              onToggleResolve={onToggleResolve}
            />
          </div>
        );
      })}
    </div>
  );
}

function CommentGutter({
  lineNum,
  commentingLine,
  onCommentingLineChange,
}: {
  lineNum: number | null | undefined;
  commentingLine: number | null;
  onCommentingLineChange: (line: number | null) => void;
}) {
  return (
    <button
      type="button"
      className="w-4 shrink-0 flex items-center justify-center opacity-0 group-hover/line:opacity-100 transition-opacity text-accent/50 hover:text-accent"
      onClick={() => {
        if (lineNum != null) {
          onCommentingLineChange(commentingLine === lineNum ? null : lineNum);
        }
      }}
      title="Add comment"
    >
      {lineNum != null && <MessageSquarePlus className="h-3 w-3" />}
    </button>
  );
}

/** Existing comments on a line plus the input when that line is being commented. */
function LineCommentThread({
  lineNum,
  commentsByLine,
  commentingLine,
  onCommentingLineChange,
  onAddComment,
  onDeleteComment,
  onToggleResolve,
}: Omit<ViewProps, "lines"> & {
  lineNum: number | null | undefined;
  commentingLine: number | null;
  onCommentingLineChange: (line: number | null) => void;
}) {
  const lineComments = lineNum != null ? commentsByLine?.[lineNum] : undefined;
  return (
    <>
      {lineComments?.map((c) => (
        <CommentCard
          key={c.id}
          comment={c}
          onDelete={onDeleteComment ?? noop}
          onToggleResolve={onToggleResolve ?? noop}
        />
      ))}

      {commentingLine === lineNum && lineNum != null && onAddComment && (
        <CommentInput
          onSubmit={(content) => {
            onAddComment(lineNum, content);
            onCommentingLineChange(null);
          }}
          onCancel={() => onCommentingLineChange(null)}
        />
      )}
    </>
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
