import {
  colabIdsOf,
  colabsOf,
  type InboxThread,
  inboxCountsOn,
  inboxNeedsYou,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronLeft, Inbox } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useDismiss } from "../../hooks/use-dismiss";
import { useColabs, useInboxThreads } from "../../hooks/use-inbox";
import { useProjects } from "../../hooks/use-trpc";
import type { InboxTarget as Target } from "../../lib/inbox-menu";
import { appKeys } from "../../lib/keymap";
import { useAppStore } from "../../stores/app";
import { InboxMenuList } from "./InboxMenuList";
import { NewThread } from "./NewThread";
import { InboxThreadView } from "./sections/InboxThreadView";

type View = { kind: "list" } | { kind: "new"; target: Target } | { kind: "thread"; id: string };

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
  const colabs = useMemo(() => colabsOf(allColabs, projectId), [allColabs, projectId]);
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
        <InboxMenuList
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
          project={{ id: projectId, name: projectName }}
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
  const colabs = useColabs();
  const open = useAppStore((s) => s.inboxMenuOpen);
  const setOpen = useAppStore((s) => s.setInboxMenuOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(rootRef, open, close);
  if (!projectId) return null;

  const colabIds = colabIdsOf(colabs, projectId);
  const threads = active.filter((t) => inboxCountsOn(t, projectId, colabIds));
  const needsYou = inboxNeedsYou(threads);

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
