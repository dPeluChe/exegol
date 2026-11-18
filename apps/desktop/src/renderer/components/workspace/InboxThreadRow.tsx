import {
  INBOX_PENDING_LABEL,
  type InboxThread,
  inboxPendingState,
  isInboxClosed,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { formatTimeAgo } from "../../lib/format";
import { plural } from "../../lib/plural";

/** A thread in a list. With `preview` it is a feed card: the whole title, then who wrote last
 *  (or how it ended) and how that starts */
export function InboxThreadRow({
  thread,
  place,
  preview,
  selected,
  onSelect,
}: {
  thread: InboxThread;
  place: string;
  preview?: { by: string; text: string };
  selected: boolean;
  onSelect: () => void;
}) {
  const pending = isInboxClosed(thread.status) ? null : inboxPendingState(thread);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left",
        selected ? "border-accent/50 bg-accent/10" : "border-border hover:bg-white/5",
      )}
    >
      <span
        className={cn(
          "text-xs text-text-primary",
          preview ? "line-clamp-2 font-medium" : "truncate",
        )}
      >
        {thread.title}
      </span>
      {preview?.text && (
        <span className="line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
          <span className="text-text-muted">{preview.by}: </span>
          {preview.text}
        </span>
      )}
      <span className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className={cn("shrink-0", pending === "needs_you" && "text-warning")}>
          {pending ? INBOX_PENDING_LABEL[pending] : thread.status}
        </span>
        {preview && <span className="shrink-0">{plural(thread.lastSeq, "message")}</span>}
        <span className="min-w-0 flex-1 truncate">{place}</span>
        <span className="shrink-0">{formatTimeAgo(thread.lastActivityAt)}</span>
      </span>
    </button>
  );
}
