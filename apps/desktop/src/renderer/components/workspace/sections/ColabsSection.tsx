import { ScrollArea } from "@exegol/ui";
import { useState } from "react";
import { useInboxThreads } from "../../../hooks/use-inbox";
import { useAppStore } from "../../../stores/app";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { InboxThreadRow } from "../InboxThreadRow";
import { inboxPlace } from "../inbox-place";
import { InboxThreadView } from "./InboxThreadView";

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
            Archived
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
              <InboxThreadRow
                key={thread.id}
                thread={thread}
                place={inboxPlace(thread, projectMeta)}
                selected={thread.id === selectedId}
                onSelect={() => setSelectedId(thread.id)}
              />
            ))}
            {threads.length === 0 && (
              <p className="py-8 text-center text-xs text-text-muted">
                {showClosed ? "No archived threads." : "Nothing pending."}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="flex max-h-full min-w-0 flex-1 flex-col self-start rounded-lg border border-border bg-bg-secondary">
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
