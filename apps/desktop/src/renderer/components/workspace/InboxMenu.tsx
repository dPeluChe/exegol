import {
  INBOX_BODY_MAX,
  INBOX_PENDING_LABEL,
  INBOX_TITLE_MAX,
  type InboxPendingState,
  type InboxThread,
  inboxPendingState,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { ChevronLeft, Inbox } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useDismiss } from "../../hooks/use-dismiss";
import { useInboxThreads } from "../../hooks/use-inbox";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";
import { INPUT_CLASS } from "../agents/SpawnOptions";
import { FilterChip } from "../common/FilterChip";
import type { ProjectMeta } from "../common/ProjectChip";
import { InboxThreadRow } from "./InboxThreadRow";
import { inboxPlace } from "./inbox-place";
import { InboxThreadView } from "./sections/InboxThreadView";

type Menu = "closed" | "list" | "new" | { id: string };

function ThreadList({
  threads,
  personal,
  meta,
  onPick,
  onNew,
}: {
  threads: InboxThread[];
  personal: InboxThread[];
  meta: ReadonlyMap<string, ProjectMeta>;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState<InboxPendingState | null>(null);
  const states = [...new Set(threads.map(inboxPendingState))];
  const shown = threads.filter((t) => !filter || inboxPendingState(t) === filter);
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

  return (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
      <div className="flex flex-wrap items-center gap-1">
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
        <Button size="sm" className="ml-auto" onClick={onNew}>
          New thread
        </Button>
      </div>
      {rows(shown)}
      {threads.length === 0 && (
        <p className="py-2 text-center text-text-muted">Nothing pending in this project</p>
      )}
      {personal.length > 0 && (
        <p className="pt-1 text-[10px] uppercase tracking-wide text-text-muted">Personal</p>
      )}
      {rows(personal)}
    </div>
  );
}

function NewThread({
  projectId,
  projectName,
  onOpened,
}: {
  projectId: string;
  projectName: string;
  onOpened: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [personal, setPersonal] = useState(false);
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

/** The active project's threads, to act from where you work. The Colabs tab is the overview */
export function InboxMenu() {
  const { projectId, project } = useProjectContext();
  const active = useInboxThreads("active");
  const [menu, setMenu] = useState<Menu>("closed");
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenu("closed"), []);
  useDismiss(rootRef, menu !== "closed", close);
  if (!projectId) return null;

  const threads = active.filter((t) => t.scopeId === projectId);
  const personal = active.filter((t) => t.scope === "personal");
  const needsYou = threads.some((t) => inboxPendingState(t) === "needs_you");
  const projectName = project?.name ?? projectId;
  const meta = new Map([[projectId, { name: projectName, color: null }]]);
  const open = menu !== "closed";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-pressed={open}
        aria-label="Inbox"
        onClick={() => setMenu(open ? "closed" : "list")}
        title={`${threads.length} inbox threads pending${needsYou ? ", some need you" : ""}`}
        className={cn(
          "relative flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium tabular-nums transition-colors hover:bg-white/5",
          open ? "bg-white/10 text-text-primary" : "text-text-muted",
        )}
      >
        <Inbox className="h-3.5 w-3.5 shrink-0" />
        {threads.length}
        {needsYou && (
          <span
            className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warning"
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 flex max-h-[70vh] w-[30rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary text-xs shadow-lg",
            typeof menu === "object" && "h-[70vh]",
          )}
        >
          {menu !== "list" && (
            <button
              type="button"
              onClick={() => setMenu("list")}
              className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Inbox
            </button>
          )}
          {menu === "list" && (
            <ThreadList
              threads={threads}
              personal={personal}
              meta={meta}
              onPick={(id) => setMenu({ id })}
              onNew={() => setMenu("new")}
            />
          )}
          {menu === "new" && (
            <NewThread
              projectId={projectId}
              projectName={projectName}
              onOpened={(id) => setMenu({ id })}
            />
          )}
          {typeof menu === "object" && (
            <div className="min-h-0 flex-1">
              <InboxThreadView
                key={menu.id}
                id={menu.id}
                projectMeta={meta}
                homeProject={projectId}
                onOpen={(id) => setMenu({ id })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
