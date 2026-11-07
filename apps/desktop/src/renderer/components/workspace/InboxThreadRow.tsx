import {
  INBOX_PENDING_LABEL,
  type InboxThread,
  inboxPendingState,
  isInboxClosed,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { formatTimeAgo } from "../../lib/format";

export function InboxThreadRow({
  thread,
  place,
  selected,
  onSelect,
}: {
  thread: InboxThread;
  place: string;
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
      <span className="truncate text-xs text-text-primary">{thread.title}</span>
      <span className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className={cn("shrink-0", pending === "needs_you" && "text-warning")}>
          {pending ? INBOX_PENDING_LABEL[pending] : thread.status}
        </span>
        <span className="min-w-0 flex-1 truncate">{place}</span>
        <span className="shrink-0">{formatTimeAgo(thread.lastActivityAt)}</span>
      </span>
    </button>
  );
}
