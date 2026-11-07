import {
  INBOX_PENDING_LABEL,
  type InboxThread,
  inboxPendingState,
  isInboxClosed,
} from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { useState } from "react";
import { useInboxThreads } from "../../../hooks/use-inbox";
import { formatTimeAgo } from "../../../lib/format";
import { useAppStore } from "../../../stores/app";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { InboxThreadView, inboxPlace } from "./InboxThreadView";

function ThreadRow({
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

/** The inbox across every project. Colabs themselves arrive with step 4 of T217 */
export function ColabsSection({ projectMeta }: { projectMeta: ReadonlyMap<string, ProjectMeta> }) {
  const [showClosed, setShowClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = useInboxThreads("active");
  const closed = useInboxThreads("closed", showClosed);
  const project = useAppStore((s) => s.inboxProject);
  const openInbox = useAppStore((s) => s.openInbox);
  const threads = (showClosed ? closed : active).filter((t) => !project || t.scopeId === project);

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4 pt-0">
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <FilterChip active={!showClosed} onClick={() => setShowClosed(false)}>
            Pending
          </FilterChip>
          <FilterChip active={showClosed} onClick={() => setShowClosed(true)}>
            Closed
          </FilterChip>
          {project && (
            <FilterChip active onClick={() => openInbox(null)}>
              {projectMeta.get(project)?.name ?? project}, show all
            </FilterChip>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1.5">
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                place={inboxPlace(thread, projectMeta)}
                selected={thread.id === selectedId}
                onSelect={() => setSelectedId(thread.id)}
              />
            ))}
            {threads.length === 0 && (
              <p className="py-8 text-center text-xs text-text-muted">
                {showClosed ? "No closed threads." : "Nothing pending."}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-bg-secondary">
        {selectedId ? (
          <InboxThreadView
            key={selectedId}
            id={selectedId}
            projectMeta={projectMeta}
            onOpen={setSelectedId}
          />
        ) : (
          <p className="py-8 text-center text-xs text-text-muted">
            Pick a thread to read it. Messages never wake a session: send it to one.
          </p>
        )}
      </div>
    </div>
  );
}
