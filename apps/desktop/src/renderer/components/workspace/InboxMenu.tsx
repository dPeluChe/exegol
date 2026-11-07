import {
  INBOX_BODY_MAX,
  INBOX_PENDING_LABEL,
  INBOX_TITLE_MAX,
  type InboxPendingState,
  type InboxThread,
  inboxPendingState,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { ChevronLeft, Inbox, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useDismiss } from "../../hooks/use-dismiss";
import { useInboxThreads } from "../../hooks/use-inbox";
import { appKeys } from "../../lib/keymap";
import { trpcMutate } from "../../lib/trpc-client";
import { useAppStore } from "../../stores/app";
import { toastError } from "../../stores/toasts";
import { INPUT_CLASS } from "../agents/SpawnOptions";
import { FilterChip } from "../common/FilterChip";
import type { ProjectMeta } from "../common/ProjectChip";
import { InboxThreadRow } from "./InboxThreadRow";
import { inboxPlace } from "./inbox-place";
import { InboxThreadView } from "./sections/InboxThreadView";

type View = "list" | "new-project" | "new-personal" | { id: string };

function ThreadList({
  active,
  projectId,
  projectName,
  meta,
  onPick,
  onNew,
}: {
  active: InboxThread[];
  projectId: string;
  projectName: string;
  meta: ReadonlyMap<string, ProjectMeta>;
  onPick: (id: string) => void;
  onNew: (personal: boolean) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<InboxPendingState | null>(null);
  const closed = useInboxThreads("closed", archived);
  const all = archived ? closed : active;
  const here = all.filter((t) => t.scopeId === projectId);
  const personal = all.filter((t) => t.scope === "personal");
  const states = archived ? [] : [...new Set(here.map(inboxPendingState))];
  const shown = here.filter((t) => !filter || inboxPendingState(t) === filter);
  const rows = (list: InboxThread[]) =>
    list.map((thread) => (
      <InboxThreadRow
        key={thread.id}
        thread={thread}
        place={inboxPlace(thread, meta)}
        selected={false}
        onSelect={() => onPick(thread.id)}
      />
    ));
  const heading = (label: string, personalScope: boolean) => (
    <div className="flex items-center pt-1 text-[10px] uppercase tracking-wide text-text-muted">
      {label}
      {!archived && (
        <button
          type="button"
          onClick={() => onNew(personalScope)}
          className="ml-auto flex items-center gap-0.5 rounded px-1 normal-case tracking-normal hover:bg-white/5 hover:text-text-primary"
        >
          <Plus className="h-3 w-3" />
          New thread
        </button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
      <div className="flex flex-wrap items-center gap-1">
        <FilterChip active={!archived} onClick={() => setArchived(false)}>
          Active
        </FilterChip>
        <FilterChip active={archived} onClick={() => setArchived(true)}>
          Archived
        </FilterChip>
        {states.length > 1 && <span className="mx-1 h-3 w-px bg-border" />}
        {states.length > 1 &&
          states.map((state) => (
            <FilterChip
              key={state}
              active={filter === state}
              onClick={() => setFilter(filter === state ? null : state)}
            >
              {INBOX_PENDING_LABEL[state]}
            </FilterChip>
          ))}
      </div>
      {heading(projectName, false)}
      {rows(shown)}
      {here.length === 0 && (
        <p className="py-1 text-center text-text-muted">
          {archived ? "Nothing archived here" : "Nothing pending in this project"}
        </p>
      )}
      {heading("Personal", true)}
      {rows(personal)}
      {personal.length === 0 && (
        <p className="py-1 text-center text-text-muted">
          {archived ? "Nothing archived" : "For anything that belongs to no project"}
        </p>
      )}
    </div>
  );
}

function NewThread({
  projectId,
  projectName,
  startPersonal,
  onOpened,
}: {
  projectId: string;
  projectName: string;
  startPersonal: boolean;
  onOpened: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [personal, setPersonal] = useState(startPersonal);
  const [busy, setBusy] = useState(false);

  const post = async () => {
    setBusy(true);
    try {
      const { id } = await trpcMutate<{ id: string }>("inbox.open", {
        title,
        body,
        projectId: personal ? null : projectId,
      });
      onOpened(id);
    } catch (err) {
      toastError("Thread not opened")(err);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <FilterChip active={!personal} onClick={() => setPersonal(false)}>
          {projectName}
        </FilterChip>
        <FilterChip active={personal} onClick={() => setPersonal(true)}>
          Personal
        </FilterChip>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={INBOX_TITLE_MAX}
        placeholder="Title"
        className={INPUT_CLASS}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        maxLength={INBOX_BODY_MAX}
        placeholder="What should a session know"
        className={INPUT_CLASS}
      />
      <Button
        size="sm"
        className="self-end"
        disabled={busy || !title.trim() || !body.trim()}
        onClick={() => void post()}
      >
        Open thread
      </Button>
    </div>
  );
}

function Panel({
  active,
  projectId,
  projectName,
}: {
  active: InboxThread[];
  projectId: string;
  projectName: string;
}) {
  const [view, setView] = useState<View>("list");
  const meta = new Map([[projectId, { name: projectName, color: null }]]);
  return (
    <div className="absolute top-full left-0 z-50 mt-1 flex max-h-[70vh] w-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary text-xs shadow-lg">
      {view !== "list" && (
        <button
          type="button"
          onClick={() => setView("list")}
          className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Inbox
        </button>
      )}
      {view === "list" && (
        <ThreadList
          active={active}
          projectId={projectId}
          projectName={projectName}
          meta={meta}
          onPick={(id) => setView({ id })}
          onNew={(personal) => setView(personal ? "new-personal" : "new-project")}
        />
      )}
      {(view === "new-project" || view === "new-personal") && (
        <NewThread
          projectId={projectId}
          projectName={projectName}
          startPersonal={view === "new-personal"}
          onOpened={(id) => setView({ id })}
        />
      )}
      {typeof view === "object" && (
        <InboxThreadView
          key={view.id}
          id={view.id}
          projectMeta={meta}
          homeProject={projectId}
          onOpen={(id) => setView({ id })}
        />
      )}
    </div>
  );
}

/** The active project's threads and Personal, to act from where you work. Colabs is the overview */
export function InboxMenu() {
  const { projectId, project } = useProjectContext();
  const active = useInboxThreads("active");
  const open = useAppStore((s) => s.inboxMenuOpen);
  const setOpen = useAppStore((s) => s.setInboxMenuOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(rootRef, open, close);
  if (!projectId) return null;

  const threads = active.filter((t) => t.scopeId === projectId);
  const needsYou = threads.some((t) => inboxPendingState(t) === "needs_you");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-pressed={open}
        aria-label="Inbox"
        onClick={() => setOpen(!open)}
        title={`Inbox (${appKeys("Cmd+Shift+I")}): ${threads.length} pending${needsYou ? ", some need you" : ""}`}
        className={cn(
          "relative flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium tabular-nums transition-colors hover:bg-white/5",
          open ? "bg-white/10 text-text-primary" : "text-text-muted",
        )}
      >
        <Inbox className="h-3.5 w-3.5 shrink-0" />
        {threads.length > 0 && threads.length}
        {needsYou && (
          <span
            className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warning"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <Panel active={active} projectId={projectId} projectName={project?.name ?? projectId} />
      )}
    </div>
  );
}
