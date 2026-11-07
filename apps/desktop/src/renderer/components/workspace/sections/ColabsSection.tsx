import type { Colab } from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { useColabs, useInboxThreads } from "../../../hooks/use-inbox";
import { useAppStore } from "../../../stores/app";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { InboxThreadRow } from "../InboxThreadRow";
import { inboxPlace } from "../inbox-place";
import { ColabEditor } from "./ColabEditor";
import { InboxThreadView } from "./InboxThreadView";

type Panel = { thread: string } | { colab: string | null } | null;

function ColabList({
  colabs,
  selected,
  onPick,
}: {
  colabs: Colab[];
  selected: string | null | undefined;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center text-[10px] uppercase tracking-wide text-text-muted">
        Colabs
        <button
          type="button"
          onClick={() => onPick(null)}
          className="ml-auto flex items-center gap-0.5 rounded px-1 normal-case tracking-normal hover:bg-white/5 hover:text-text-primary"
        >
          <Plus className="h-3 w-3" />
          New colab
        </button>
      </div>
      {colabs.length === 0 && (
        <p className="text-[11px] text-text-muted">
          None yet. A colab joins projects that work together, like a blueprint and its clones.
        </p>
      )}
      {colabs.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
            selected === c.id ? "border-[var(--accent)]/60" : "border-border",
          )}
        >
          <Users className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate text-text-primary">{c.name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-text-muted">
            {c.members.length} member{c.members.length === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The inbox across every project. Colabs themselves arrive with step 4 of T217 */
export function ColabsSection({ projectMeta }: { projectMeta: ReadonlyMap<string, ProjectMeta> }) {
  const [showClosed, setShowClosed] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const colabs = useColabs();
  const selectedId = panel && "thread" in panel ? panel.thread : null;
  const setSelectedId = (id: string) => setPanel({ thread: id });
  const editing = panel && "colab" in panel ? panel.colab : undefined;
  const editedColab = editing ? (colabs.find((c) => c.id === editing) ?? null) : null;
  const active = useInboxThreads("active");
  const closed = useInboxThreads("closed", showClosed);
  const project = useAppStore((s) => s.inboxProject);
  const openInbox = useAppStore((s) => s.openInbox);
  const threads = (showClosed ? closed : active).filter((t) => !project || t.scopeId === project);

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4 pt-0">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <ColabList colabs={colabs} selected={editing} onPick={(id) => setPanel({ colab: id })} />
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
        {editing !== undefined ? (
          <ColabEditor
            key={editing ?? "new"}
            colab={editedColab}
            projectMeta={projectMeta}
            onSaved={(id) => setPanel({ colab: id })}
            onDeleted={() => setPanel(null)}
          />
        ) : selectedId ? (
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
