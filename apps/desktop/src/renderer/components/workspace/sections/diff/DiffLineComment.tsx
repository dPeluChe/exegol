import type { DiffComment } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Check, MessageSquare, Trash2, Undo2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

// ─── Comment input ──────────────────────────────────────────────────────────

interface CommentInputProps {
  onSubmit: (content: string) => void;
  onCancel: () => void;
}

export function CommentInput({ onSubmit, onCancel }: CommentInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }, [value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel],
  );

  return (
    <div className="flex gap-1.5 border-t border-border/40 bg-bg-secondary/60 px-3 py-2">
      <MessageSquare className="mt-1 h-3 w-3 shrink-0 text-accent/60" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          rows={2}
          className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
          // biome-ignore lint/a11y/noAutofocus: user explicitly clicked to add comment
          autoFocus
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim()}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              value.trim()
                ? "bg-accent text-white hover:bg-accent/90"
                : "bg-bg-tertiary text-text-muted cursor-not-allowed",
            )}
          >
            Comment
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <span className="ml-auto text-[9px] text-text-muted">Cmd+Enter</span>
        </div>
      </div>
    </div>
  );
}

// ─── Comment card ───────────────────────────────────────────────────────────

interface CommentCardProps {
  comment: DiffComment;
  onDelete: (id: string) => void;
  onToggleResolve: (id: string) => void;
}

export function CommentCard({ comment, onDelete, onToggleResolve }: CommentCardProps) {
  const timeAgo = formatTimeAgo(comment.createdAt);

  return (
    <div
      className={cn(
        "flex gap-2 border-t border-border/40 px-3 py-1.5",
        comment.resolved ? "bg-green-500/5" : "bg-yellow-500/5",
      )}
    >
      <MessageSquare
        className={cn(
          "mt-0.5 h-3 w-3 shrink-0",
          comment.resolved ? "text-green-400/60" : "text-yellow-400/60",
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "whitespace-pre-wrap text-[11px]",
            comment.resolved ? "text-text-muted line-through" : "text-text-primary",
          )}
        >
          {comment.content}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[9px] text-text-muted">{timeAgo}</span>
          <button
            type="button"
            onClick={() => onToggleResolve(comment.id)}
            title={comment.resolved ? "Unresolve" : "Resolve"}
            className="flex items-center gap-0.5 text-[9px] text-text-muted hover:text-accent"
          >
            {comment.resolved ? (
              <>
                <Undo2 className="h-2.5 w-2.5" /> Reopen
              </>
            ) : (
              <>
                <Check className="h-2.5 w-2.5" /> Resolve
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
            className="flex items-center gap-0.5 text-[9px] text-text-muted hover:text-red-400"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
