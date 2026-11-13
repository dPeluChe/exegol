import { type Colab, inboxProjectOf } from "@exegol/shared";
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
import { ColabsHelp } from "./ColabsHelp";
import { InboxThreadView } from "./InboxThreadView";

type Panel = { kind: "thread"; id: string } | { kind: "colab"; id: string | null } | null;

function ColabList({
  colabs,
  selected,
  onPick,
  onHelp,
}: {
  colabs: Colab[];
  selected: string | null;
  onPick: (id: string | null) => void;
  /** Set while the explanation is hidden: brings it back */
  onHelp: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center text-[10px] uppercase tracking-wide text-text-muted">
        Colabs
        {onHelp && (
          <button
            type="button"
            onClick={onHelp}
            className="ml-2 rounded px-1 normal-case tracking-normal hover:bg-white/5 hover:text-text-primary"
          >
            How they work
          </button>
        )}
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
        <p className="text-[11px] text-text-muted">None yet. Create one to join two projects.</p>
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
  const [picked, setPicked] = useState<Panel>(null);
  const draft = useAppStore((s) => s.colabDraft);
  const helpHidden = useAppStore((s) => s.colabsHelpHidden);
  const setHelpHidden = useAppStore((s) => s.setColabsHelpHidden);
  // A New colab asked from elsewhere (the Inbox menu) wins until something is picked here
  const panel: Panel = draft ? { kind: "colab", id: null } : picked;
  const setPanel = (next: Panel) => {
    useAppStore.getState().clearColabDraft();
    setPicked(next);
  };
  const colabs = useColabs();
  const selectedId = panel?.kind === "thread" ? panel.id : null;
  const setSelectedId = (id: string) => setPanel({ kind: "thread", id });
  const editing = panel?.kind === "colab" ? panel.id : null;
  const active = useInboxThreads("active");
  const closed = useInboxThreads("closed", showClosed);
  const project = useAppStore((s) => s.inboxProject);
  const openInbox = useAppStore((s) => s.openInbox);
  const colabNames = new Map(colabs.map((c) => [c.id, c.name]));
  const edited = colabs.find((c) => c.id === editing) ?? null;
  // A colab open in the editor narrows the list to its threads
  const threads = (showClosed ? closed : active)
    .filter((t) => !project || inboxProjectOf(t) === project)
    .filter((t) => !editing || (t.scope === "colab" && t.scopeId === editing));

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4 pt-0">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <ColabList
          colabs={colabs}
          selected={editing}
          onPick={(id) => setPanel({ kind: "colab", id })}
          onHelp={
            helpHidden
              ? () => {
                  setHelpHidden(false);
                  setPanel(null);
                }
              : null
          }
        />
        <div className="text-[10px] uppercase tracking-wide text-text-muted">
          Threads of every project
        </div>
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
                place={inboxPlace(thread, projectMeta, colabNames)}
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
        {panel?.kind === "colab" && editing && !edited ? (
          <p className="py-8 text-center text-xs text-text-muted">Loading the colab…</p>
        ) : panel?.kind === "colab" ? (
          <ColabEditor
            key={editing ?? "new"}
            colab={edited}
            firstMember={draft?.projectId ?? null}
            projectMeta={projectMeta}
            onSaved={(id) => setPanel({ kind: "colab", id })}
            onDeleted={() => setPanel(null)}
          />
        ) : selectedId ? (
          <InboxThreadView
            key={selectedId}
            id={selectedId}
            projectMeta={projectMeta}
            onOpen={setSelectedId}
          />
        ) : !helpHidden ? (
          <ColabsHelp
            onNew={() => setPanel({ kind: "colab", id: null })}
            onHide={() => setHelpHidden(true)}
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
