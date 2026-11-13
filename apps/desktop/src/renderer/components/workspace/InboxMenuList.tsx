import {
  type Colab,
  INBOX_PENDING_LABEL,
  type InboxPendingState,
  type InboxThread,
  inboxPendingState,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useInboxThreads } from "../../hooks/use-inbox";
import { type InboxTarget, inboxTabs, shownTab } from "../../lib/inbox-menu";
import { useAppStore } from "../../stores/app";
import { FilterChip } from "../common/FilterChip";
import type { ProjectMeta } from "../common/ProjectChip";
import { InboxThreadRow } from "./InboxThreadRow";
import { inboxPlace } from "./inbox-place";

const EMPTY: Record<InboxTarget["kind"], string> = {
  project: "Nothing pending in this project",
  colab: "Nothing pending in this colab",
  personal: "For anything that belongs to no project",
};

const ADD_CLASS =
  "ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-white/5 hover:text-text-primary";

export function InboxMenuList({
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
  onNew: (target: InboxTarget) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<InboxPendingState | null>(null);
  const closed = useInboxThreads("closed", archived);
  const tabs = inboxTabs(archived ? closed : active, projectId, projectName, colabs);
  const tab = shownTab(tabs, picked);
  const colabNames = new Map(colabs.map((c) => [c.id, c.name]));
  const states = archived ? [] : [...new Set(tab.threads.map(inboxPendingState))];
  const state = filter && states.includes(filter) ? filter : null;
  const shown = tab.threads.filter((t) => !state || inboxPendingState(t) === state);

  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" className="flex items-center gap-1 border-b border-border px-2 pt-1.5">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === tab.key}
              onClick={() => setPicked(t.key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-1.5 pb-1.5 text-[11px] font-medium",
                t.key === tab.key
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary",
              )}
            >
              <span className="max-w-40 truncate">{t.label}</span>
              {t.threads.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 text-[10px] tabular-nums">
                  {t.threads.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => useAppStore.getState().openNewColab(projectId)}
          title="Join this project with others so their sessions share threads"
          className={cn(ADD_CLASS, "mb-1")}
        >
          <Plus className="h-3 w-3" />
          Colab
        </button>
      </div>
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
            states.map((s) => (
              <FilterChip
                key={s}
                active={state === s}
                onClick={() => setFilter(state === s ? null : s)}
              >
                {INBOX_PENDING_LABEL[s]}
              </FilterChip>
            ))}
          {!archived && (
            <button type="button" onClick={() => onNew(tab.target)} className={ADD_CLASS}>
              <Plus className="h-3 w-3" />
              New thread
            </button>
          )}
        </div>
        {shown.map((thread) => (
          <InboxThreadRow
            key={thread.id}
            thread={thread}
            place={inboxPlace(thread, meta, colabNames)}
            selected={false}
            onSelect={() => onPick(thread.id)}
          />
        ))}
        {tab.threads.length === 0 && (
          <p className="py-3 text-center text-text-muted">
            {archived ? "Nothing archived here" : EMPTY[tab.target.kind]}
          </p>
        )}
      </div>
    </div>
  );
}
