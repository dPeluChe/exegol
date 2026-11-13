import {
  type Colab,
  INBOX_BODY_MAX,
  INBOX_PENDING_LABEL,
  INBOX_TITLE_MAX,
  type InboxPendingState,
  type InboxThread,
  inboxPendingState,
  inboxProjectOf,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { ChevronLeft, Inbox, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useAct } from "../../hooks/use-act";
import { useDismiss } from "../../hooks/use-dismiss";
import { useColabs, useInboxThreads } from "../../hooks/use-inbox";
import { useProjects } from "../../hooks/use-trpc";
import { appKeys } from "../../lib/keymap";
import { useAppStore } from "../../stores/app";
import { INPUT_CLASS } from "../agents/SpawnOptions";
import { FilterChip } from "../common/FilterChip";
import type { ProjectMeta } from "../common/ProjectChip";
import { InboxThreadRow } from "./InboxThreadRow";
import { inboxPlace } from "./inbox-place";
import { InboxThreadView } from "./sections/InboxThreadView";

/** `to`: the member project a colab thread is for, null for the whole colab */
type Target =
  | { kind: "project" }
  | { kind: "personal" }
  | { kind: "colab"; id: string; to: string | null };
type View = { kind: "list" } | { kind: "new"; target: Target } | { kind: "thread"; id: string };

function ThreadList({
  active,
  projectId,
  projectName,
  meta,
  colabs,
  onPick,
  onNew,
}: {
  active: InboxThread[];
  projectId: string;
  projectName: string;
  meta: ReadonlyMap<string, ProjectMeta>;
  /** The colabs this project is in */
  colabs: Colab[];
  onPick: (id: string) => void;
  onNew: (target: Target) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<InboxPendingState | null>(null);
  const closed = useInboxThreads("closed", archived);
  const all = archived ? closed : active;
  const here = all.filter((t) => inboxProjectOf(t) === projectId);
  const personal = all.filter((t) => t.scope === "personal");
  const colabNames = new Map(colabs.map((c) => [c.id, c.name]));
  const inColab = (id: string) =>
    all.filter((t) => t.scope === "colab" && t.scopeId === id && inboxProjectOf(t) !== projectId);
  const states = archived ? [] : [...new Set(here.map(inboxPendingState))];
  const shown = here.filter((t) => !filter || inboxPendingState(t) === filter);
  const rows = (list: InboxThread[]) =>
    list.map((thread) => (
      <InboxThreadRow
        key={thread.id}
        thread={thread}
        place={inboxPlace(thread, meta, colabNames)}
        selected={false}
        onSelect={() => onPick(thread.id)}
      />
    ));
  const heading = (label: string, target: Target) => (
    <div className="flex items-center pt-1 text-[10px] uppercase tracking-wide text-text-muted">
      {label}
      {!archived && (
        <button
          type="button"
          onClick={() => onNew(target)}
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
      {heading(projectName, { kind: "project" })}
      {rows(shown)}
      {here.length === 0 && (
        <p className="py-1 text-center text-text-muted">
          {archived ? "Nothing archived here" : "Nothing pending in this project"}
        </p>
      )}
      {colabs.map((c) => (
        <div key={c.id} className="flex flex-col gap-1.5">
          {heading(c.name, { kind: "colab", id: c.id, to: null })}
          {rows(inColab(c.id))}
        </div>
      ))}
      {!archived && (
        <div className="flex items-center pt-1 text-[10px] uppercase tracking-wide text-text-muted">
          {colabs.length === 0 ? "No colab with another project yet" : "Another colab"}
          <button
            type="button"
            onClick={() => useAppStore.getState().openNewColab(projectId)}
            title="Join this project with others so their sessions share threads"
            className="ml-auto flex items-center gap-0.5 rounded px-1 normal-case tracking-normal hover:bg-white/5 hover:text-text-primary"
          >
            <Plus className="h-3 w-3" />
            New colab
          </button>
        </div>
      )}
      {heading("Personal", { kind: "personal" })}
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
  colabs,
  meta,
  start,
  onOpened,
}: {
  projectId: string;
  projectName: string;
  colabs: Colab[];
  meta: ReadonlyMap<string, ProjectMeta>;
  start: Target;
  onOpened: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<Target>(start);
  const { busy, act } = useAct("Thread not opened");
  const colab = target.kind === "colab" ? colabs.find((c) => c.id === target.id) : undefined;
  const memberIds = [...new Set(colab?.members.map((m) => m.projectId))];

  const post = async () => {
    const opened = await act<{ id: string }>("inbox.open", {
      title,
      body,
      projectId: target.kind === "project" ? projectId : null,
      ...(target.kind === "colab" && { colabId: target.id, toProject: target.to }),
    });
    if (opened) onOpened(opened.value.id);
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <FilterChip
          active={target.kind === "project"}
          onClick={() => setTarget({ kind: "project" })}
        >
          {projectName}
        </FilterChip>
        {colabs.map((c) => (
          <FilterChip
            key={c.id}
            active={colab?.id === c.id}
            onClick={() => setTarget({ kind: "colab", id: c.id, to: null })}
          >
            {c.name}
          </FilterChip>
        ))}
        <FilterChip
          active={target.kind === "personal"}
          onClick={() => setTarget({ kind: "personal" })}
        >
          Personal
        </FilterChip>
      </div>
      {colab && (
        <select
          value={target.kind === "colab" ? (target.to ?? "") : ""}
          onChange={(e) => setTarget({ kind: "colab", id: colab.id, to: e.target.value || null })}
          className={INPUT_CLASS}
        >
          <option value="">For the whole colab</option>
          {memberIds.map((id) => (
            <option key={id} value={id}>
              For {meta.get(id)?.name ?? id}
            </option>
          ))}
        </select>
      )}
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
  const [view, setView] = useState<View>({ kind: "list" });
  const { data: projects } = useProjects();
  const allColabs = useColabs();
  const colabs = useMemo(
    () => allColabs.filter((c) => c.members.some((m) => m.projectId === projectId)),
    [allColabs, projectId],
  );
  const meta = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, { name: p.name, color: p.color ?? null }])),
    [projects],
  );
  const thread = (id: string) => setView({ kind: "thread", id });
  return (
    <div className="absolute top-full left-0 z-50 mt-1 flex max-h-[60vh] w-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary text-xs shadow-lg">
      {view.kind !== "list" && (
        <button
          type="button"
          onClick={() => setView({ kind: "list" })}
          className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Inbox
        </button>
      )}
      {view.kind === "list" && (
        <ThreadList
          active={active}
          projectId={projectId}
          projectName={projectName}
          meta={meta}
          colabs={colabs}
          onPick={thread}
          onNew={(target) => setView({ kind: "new", target })}
        />
      )}
      {view.kind === "new" && (
        <NewThread
          projectId={projectId}
          projectName={projectName}
          colabs={colabs}
          meta={meta}
          start={view.target}
          onOpened={thread}
        />
      )}
      {view.kind === "thread" && (
        <InboxThreadView
          key={view.id}
          id={view.id}
          projectMeta={meta}
          homeProject={projectId}
          onOpen={thread}
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

  const threads = active.filter((t) => inboxProjectOf(t) === projectId);
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
