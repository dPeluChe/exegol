import { colabIdsOf, inboxCountsOn } from "@exegol/shared";
import { ScrollArea } from "@exegol/ui";
import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useColabs, useInboxThreads } from "../../../hooks/use-inbox";
import { ALL_THREADS, channelThreads, PERSONAL } from "../../../lib/colab-channels";
import { plural } from "../../../lib/plural";
import { useAppStore } from "../../../stores/app";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { HEAD_BUTTON } from "../InboxMenuList";
import { InboxThreadRow } from "../InboxThreadRow";
import { inboxPlace } from "../inbox-place";
import { NewThread } from "../NewThread";
import { ColabChannels } from "./ColabChannels";
import { ColabEditor } from "./ColabEditor";
import { ColabOverview } from "./ColabOverview";
import { ColabsHelp } from "./ColabsHelp";
import { InboxThreadView } from "./InboxThreadView";

/** Colabs as channels: the lists on the left, the picked one's threads, then the thread, the
 *  colab's overview, its settings or a new thread */
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
  const loading = channel !== view.channel && panel?.kind === "settings";
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

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4 pt-0">
      <ColabChannels
        colabs={colabs}
        active={active}
        channel={channel}
        onPick={show}
        onNew={() => show(ALL_THREADS, { kind: "newColab" })}
        onHelp={
          helpHidden
            ? () => {
                setHelpHidden(false);
                show(ALL_THREADS);
              }
            : undefined
        }
      />
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
            {title}
          </h2>
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
        {colab && (
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="truncate text-left text-[10px] text-text-muted hover:text-text-secondary"
          >
            {plural(colab.members.length, "member")}
            {colab.purpose ? `, ${colab.purpose}` : ""}
          </button>
        )}
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
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1.5">
            {threads.map((thread) => (
              <InboxThreadRow
                key={thread.id}
                thread={thread}
                place={inboxPlace(thread, projectMeta, colabNames)}
                selected={thread.id === selectedId}
                onSelect={() => openThread(thread.id)}
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
      <div className="flex max-h-full min-w-0 flex-1 flex-col self-start overflow-y-auto rounded-lg border border-border bg-bg-secondary">
        {loading ? (
          <p className="py-8 text-center text-xs text-text-muted">Loading the colab…</p>
        ) : panel?.kind === "newColab" || (colab && panel?.kind === "settings") ? (
          <ColabEditor
            key={colab?.id ?? "new"}
            colab={panel.kind === "settings" ? colab : null}
            firstMember={
              panel.kind === "newColab" && panel.firstMember
                ? { id: panel.firstMember, name: projectMeta.get(panel.firstMember)?.name }
                : null
            }
            onSaved={(id) => show(id, { kind: "settings" })}
            onDeleted={() => show(ALL_THREADS)}
          />
        ) : selectedId ? (
          <InboxThreadView
            key={selectedId}
            id={selectedId}
            projectMeta={projectMeta}
            onOpen={openThread}
          />
        ) : colab && panel?.kind === "newThread" ? (
          <NewThread
            key={colab.id}
            project={null}
            colabs={[colab]}
            meta={projectMeta}
            start={{ kind: "colab", id: colab.id, to: null }}
            onOpened={openThread}
          />
        ) : colab ? (
          <ColabOverview colab={colab} />
        ) : !helpHidden ? (
          <ColabsHelp
            onNew={() => show(ALL_THREADS, { kind: "newColab" })}
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
