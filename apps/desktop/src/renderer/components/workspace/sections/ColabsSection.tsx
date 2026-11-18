import {
  colabIdsOf,
  INBOX_PREVIEW_CHARS,
  type InboxThread,
  inboxCountsOn,
  isInboxClosed,
  speechSentences,
} from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { Plus, Settings, X } from "lucide-react";
import { useState } from "react";
import { useColabs, useInboxThreads } from "../../../hooks/use-inbox";
import { ALL_THREADS, channelThreads, PERSONAL } from "../../../lib/colab-channels";
import { useAppStore } from "../../../stores/app";
import { LABEL_CLASS } from "../../agents/SpawnOptions";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { HEAD_BUTTON } from "../InboxMenuList";
import { InboxThreadRow } from "../InboxThreadRow";
import { authorKindLabel, inboxPlace, nameOf } from "../inbox-place";
import { NewThread } from "../NewThread";
import { ColabChannels } from "./ColabChannels";
import { ColabEditor } from "./ColabEditor";
import { ColabMembers } from "./ColabMembers";
import { ColabsHelp } from "./ColabsHelp";
import { InboxThreadView } from "./InboxThreadView";

/** The feed's second line: who wrote last and how it starts, or how a closed one ended */
const previewOf = (thread: InboxThread, meta: ReadonlyMap<string, ProjectMeta>) =>
  isInboxClosed(thread.status)
    ? { by: thread.status, text: thread.resolution ?? "" }
    : {
        by: authorKindLabel(thread.lastAuthorKind, nameOf(meta, thread.lastProject)),
        text: speechSentences(thread.lastPreview, INBOX_PREVIEW_CHARS).join(" "),
      };

/** Colabs as channels: the lists on the left, the picked one's threads as a feed, and a side
 *  panel for the thread, the colab's settings or a new thread */
export function ColabsSection({ projectMeta }: { projectMeta: ReadonlyMap<string, ProjectMeta> }) {
  const [showClosed, setShowClosed] = useState(false);
  const view = useAppStore((s) => s.colabsView);
  const show = useAppStore((s) => s.showColabs);
  const setPanel = useAppStore((s) => s.setColabsPanel);
  const helpHidden = useAppStore((s) => s.colabsHelpHidden);
  const setHelpHidden = useAppStore((s) => s.setColabsHelpHidden);
  const project = useAppStore((s) => s.inboxProject);
  const openInbox = useAppStore((s) => s.openInbox);
  const colabs = useColabs();
  const active = useInboxThreads("active");
  const closed = useInboxThreads("closed", showClosed);

  const { panel } = view;
  const colab = colabs.find((c) => c.id === view.channel) ?? null;
  // A colab that is gone lists everything
  const channel = colab || view.channel === PERSONAL ? view.channel : ALL_THREADS;
  const selectedId = panel?.kind === "thread" ? panel.id : null;
  const openThread = (id: string) => setPanel({ kind: "thread", id });
  const colabNames = new Map(colabs.map((c) => [c.id, c.name]));
  const colabIds = colabIdsOf(colabs, project ?? "");
  // A Company room badge narrows All threads to what counts on that project
  const narrowed = channel === ALL_THREADS ? project : null;
  const threads = channelThreads(showClosed ? closed : active, channel).filter(
    (t) => !narrowed || inboxCountsOn(t, narrowed, colabIds),
  );
  const title = colab?.name ?? (channel === PERSONAL ? "Personal" : "All threads");
  const newColab = () => show(ALL_THREADS, { kind: "newColab" });

  const sidePanel = (): { label: string; body: React.ReactNode } | null => {
    if (panel?.kind === "settings" || panel?.kind === "newColab") {
      const edited = panel.kind === "settings" ? colab : null;
      const first = panel.kind === "newColab" ? panel.firstMember : undefined;
      return {
        label: edited ? "Settings" : "New colab",
        body:
          panel.kind === "settings" && !colab ? (
            <p className={EMPTY}>Loading the colab…</p>
          ) : (
            <ColabEditor
              key={edited?.id ?? "new"}
              colab={edited}
              firstMember={first ? { id: first, name: projectMeta.get(first)?.name } : null}
              onSaved={(id) => show(id, { kind: "settings" })}
              onDeleted={() => show(ALL_THREADS)}
            />
          ),
      };
    }
    if (selectedId) {
      return {
        label: "Thread",
        body: (
          <InboxThreadView
            key={selectedId}
            id={selectedId}
            projectMeta={projectMeta}
            onOpen={openThread}
          />
        ),
      };
    }
    if (colab && panel?.kind === "newThread") {
      return {
        label: `New thread in ${colab.name}`,
        body: (
          <NewThread
            key={colab.id}
            project={null}
            colabs={[colab]}
            meta={projectMeta}
            start={{ kind: "colab", id: colab.id, to: null }}
            onOpened={openThread}
          />
        ),
      };
    }
    if (!helpHidden && channel === ALL_THREADS) {
      return {
        label: "How colabs work",
        body: <ColabsHelp onNew={newColab} onHide={() => setHelpHidden(true)} />,
      };
    }
    return null;
  };
  const side = sidePanel();
  const closeSide = () => (panel ? setPanel(null) : setHelpHidden(true));

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4 pt-0">
      <ColabChannels
        colabs={colabs}
        active={active}
        channel={channel}
        onPick={show}
        onNew={newColab}
        onHelp={
          helpHidden
            ? () => {
                setHelpHidden(false);
                show(ALL_THREADS);
              }
            : undefined
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold text-text-primary">{title}</h2>
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-text-muted"
              title={colab?.purpose}
            >
              {colab?.purpose}
            </span>
            {colab && (
              <>
                <button
                  type="button"
                  disabled={colab.members.length === 0}
                  onClick={() => setPanel({ kind: "newThread" })}
                  className={HEAD_BUTTON}
                >
                  <Plus className="h-3 w-3" />
                  Thread
                </button>
                <button
                  type="button"
                  onClick={() => setPanel({ kind: "settings" })}
                  className={HEAD_BUTTON}
                >
                  <Settings className="h-3 w-3" />
                  Settings
                </button>
              </>
            )}
          </div>
          {colab && <ColabMembers colab={colab} />}
          <div className="flex items-center gap-1">
            <FilterChip active={!showClosed} onClick={() => setShowClosed(false)}>
              Pending
            </FilterChip>
            <FilterChip active={showClosed} onClick={() => setShowClosed(true)}>
              Archived
            </FilterChip>
            {narrowed && (
              <FilterChip active onClick={() => openInbox(null)}>
                {projectMeta.get(narrowed)?.name ?? narrowed}, show all
              </FilterChip>
            )}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 gap-3">
          <ScrollArea className={cn("min-h-0 min-w-0 flex-1", side && "max-xl:hidden")}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-2">
              {threads.map((thread) => (
                <InboxThreadRow
                  key={thread.id}
                  thread={thread}
                  place={inboxPlace(thread, projectMeta, colabNames)}
                  preview={previewOf(thread, projectMeta)}
                  selected={thread.id === selectedId}
                  onSelect={() => openThread(thread.id)}
                />
              ))}
            </div>
            {threads.length === 0 && (
              <p className={EMPTY}>{showClosed ? "No archived threads." : "Nothing pending."}</p>
            )}
          </ScrollArea>
          {side && (
            <aside className="flex max-h-full min-h-0 w-[min(60rem,58%)] shrink-0 flex-col self-start rounded-lg border border-border bg-bg-secondary max-xl:w-auto max-xl:flex-1">
              <div className={cn("flex items-center px-3 pt-2", LABEL_CLASS)}>
                {side.label}
                <button
                  type="button"
                  aria-label="Close the panel"
                  onClick={closeSide}
                  className="ml-auto rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{side.body}</div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY = "py-8 text-center text-xs text-text-muted";
