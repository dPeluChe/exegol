import { type DeskFacts, type DoneSession, inboxProjectOf } from "@exegol/shared";
import { ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { type ImperativePanelHandle, Panel, PanelGroup } from "react-resizable-panels";
import { useCliUpdates } from "../../../hooks/use-cli-updates";
import { useCompanyKeys } from "../../../hooks/use-company-keys";
import { useInboxThreads } from "../../../hooks/use-inbox";
import { useLatest } from "../../../hooks/use-latest";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { useWindowWide } from "../../../hooks/use-window-wide";
import { buildRooms, todayStrip } from "../../../lib/company";
import { adjacentId } from "../../../lib/pane-focus";
import { trpcInvoke } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { type CompanyView, useAppStore } from "../../../stores/app";
import { useNotificationPrefsStore } from "../../../stores/notification-prefs";
import { PanelDivider } from "../../common/PanelDivider";
import type { ProjectMeta } from "../../common/ProjectChip";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { CommanderPanel, useCommanderSession } from "./CommanderPanel";
import { RoomCard, TodayCard } from "./CompanyRooms";
import { CompanySession } from "./CompanySession";

type SideTab = "commander" | "session";
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "session", label: "Session" },
];
/** Three columns need this much window; under it the Commander and the session share one */
const THREE_COLUMNS_PX = 1500;
const COMMANDER_SIZE = 26;

const pickDesk = (id: string) => {
  useAppStore.getState().setCompanyPickedId(id);
  useAgentStore.getState().markTurnSeen(id);
};

const whereOf = (a: AgentState) => a.branchName ?? "repo root";

/** Cross-project offices: a room per project with live sessions, a desk per session */
export function CompanySection({
  projectMeta,
  commander = false,
}: {
  projectMeta: Map<string, ProjectMeta>;
  /** The Commander's chat as a column of its own; its project is then no room */
  commander?: boolean;
}) {
  const allAgents = useAgentStore((s) => s.agents);
  const own = useCommanderSession(commander);
  const hidden = commander ? own.projectId : null;
  const agents = useMemo(
    () => Object.values(allAgents).filter((a) => a.projectId !== hidden),
    [allAgents, hidden],
  );
  const wide = useWindowWide(THREE_COLUMNS_PX);
  const [sideTab, setSideTab] = useState<SideTab>("commander");
  // On a narrow window a picked desk takes the shared column from the Commander
  const pickHere = (id: string) => {
    pickDesk(id);
    setSideTab("session");
  };
  const attention = useAgentStore((s) => s.attentionItems);
  const interruption = useNotificationPrefsStore((s) => s.interruption);
  const cliUpdates = useCliUpdates();
  const outdated = useMemo(
    () => new Set([...cliUpdates.values()].filter((c) => c.updateAvailable).map((c) => c.cliType)),
    [cliUpdates],
  );
  const [seenAt] = useState(() => useAppStore.getState().companySeenAt);
  const { data: done = [] } = useQuery({
    queryKey: ["agents", "doneSince", seenAt],
    queryFn: () => trpcInvoke<DoneSession[]>("agents.doneSince", { since: seenAt }),
    refetchInterval: 30_000,
  });

  const { data: deskFacts } = useQuery({
    queryKey: ["agents", "deskFacts"],
    queryFn: () => trpcInvoke<Record<string, DeskFacts>>("agents.deskFacts"),
    refetchInterval: 60_000,
  });

  const unseen = useAgentStore((s) => s.unseenTurns);
  const inbox = useInboxThreads("active");
  const rooms = useMemo(() => buildRooms(agents, attention, unseen), [agents, attention, unseen]);
  const today = useMemo(() => {
    const levelOf = (projectId: string) => interruption[projectId] ?? "all";
    return todayStrip(agents, attention, { levelOf, outdated, unseen });
  }, [agents, attention, interruption, outdated, unseen]);
  const pickedId = useAppStore((s) => s.companyPickedId);
  const setPickedId = useAppStore((s) => s.setCompanyPickedId);
  const live = rooms.flatMap((r) => r.desks);
  const selected =
    live.find((a) => a.id === pickedId) ?? today.needs[0] ?? today.stuck[0] ?? live[0];
  const pickNext = () => {
    const next = adjacentId(
      today.needs.map((a) => a.id),
      selected?.id ?? null,
      "next",
    );
    if (next) pickHere(next);
  };

  useCompanyKeys({ pickNext, pick: pickHere, selected, live });

  // A default moves with states: the one on screen stays for the way back, unless one was picked
  const shownId = useLatest(selected?.id);
  useMountEffect(() => {
    requestAnimationFrame(() =>
      document
        .querySelector('[aria-pressed="true"][data-desk-id]')
        ?.scrollIntoView({ block: "nearest" }),
    );
    return () => {
      if (shownId.current && !useAppStore.getState().companyPickedId) setPickedId(shownId.current);
    };
  });

  const sessionPanel = useRef<ImperativePanelHandle>(null);
  const view = useAppStore((s) => s.companyView);
  const side = useAppStore((s) => s.companySessionSide);
  const ownChat = commander && own.state && (
    <CommanderPanel session={own.session} state={own.state} />
  );
  // One column for both chats on a narrow window
  const stacked = !!ownChat && !wide;
  const threeColumns = !!ownChat && wide;
  // The third column takes its share from the session, and the rooms keep a fifth
  const sessionMax = threeColumns ? 100 - COMMANDER_SIZE - 20 : 70;
  const storedSize = (v: CompanyView) =>
    Math.min(useAppStore.getState().companySessionSizes[v], sessionMax);
  const pickView = (next: CompanyView) => {
    useAppStore.getState().setCompanyView(next);
    sessionPanel.current?.resize(storedSize(next));
  };
  // Company's own widths: the combined view shares them and leaves them as they are
  const keepSize = (dragging: boolean) => {
    const size = sessionPanel.current?.getSize();
    if (!dragging && size && !commander) useAppStore.getState().setCompanySessionSize(view, size);
  };
  // Read as a Panel mounts: later widths come from dragging or `pickView`
  const sessionSize = storedSize(view);
  const divider = selected && <PanelDivider onDragging={keepSize} />;
  const left = side === "left";
  const selectedSession = selected && (
    <CompanySession
      key={selected.id}
      agent={selected}
      where={`${projectMeta.get(selected.projectId)?.name ?? ""} · ${whereOf(selected)}`}
      picked={view}
      onPick={pickView}
    />
  );
  const session = selected && (
    <Panel
      ref={sessionPanel}
      id="session"
      order={2}
      defaultSize={sessionSize}
      minSize={20}
      maxSize={sessionMax}
      // Using the panel holds it: a default selection moves as states change
      onFocusCapture={() => {
        if (!stacked || sideTab === "session") pickDesk(selected.id);
      }}
    >
      {stacked ? (
        <div className="flex h-full flex-col gap-2">
          <SegmentedTabs
            tabs={SIDE_TABS}
            active={sideTab}
            onChange={setSideTab}
            compact
            label="Commander or the selected session"
          />
          <div className="min-h-0 flex-1">
            {sideTab === "commander" ? ownChat : selectedSession}
          </div>
        </div>
      ) : (
        selectedSession
      )}
    </Panel>
  );
  const ownColumn = threeColumns && (
    <Panel
      id="commander"
      order={left ? 1 : 3}
      defaultSize={COMMANDER_SIZE}
      minSize={18}
      maxSize={50}
    >
      {ownChat}
    </Panel>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <TodayCard
          label="Needs you"
          tone="text-amber-400"
          agents={today.needs}
          onClick={pickNext}
        />
        <TodayCard label="Stuck" tone="text-error" agents={today.stuck} />
        <TodayCard label="Can wait" tone="text-accent" agents={today.canWait} />
        <TodayCard label="Done since you left" tone="text-green-400" agents={done} />
      </div>
      {rooms.length === 0 ? (
        <>
          <p className="py-2 text-center text-xs text-text-muted">No live sessions right now.</p>
          {ownChat && (
            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{ownChat}</div>
          )}
        </>
      ) : (
        // Keyed: the panels change order, so the group starts over from the stored widths
        <PanelGroup
          key={`${side}:${threeColumns ? 3 : 2}`}
          direction="horizontal"
          className="min-h-0 flex-1"
        >
          {left && ownColumn}
          {left && ownColumn && <PanelDivider />}
          {left && session}
          {left && divider}
          <Panel
            id="rooms"
            order={left ? 3 : 1}
            defaultSize={100 - sessionSize - (threeColumns ? COMMANDER_SIZE : 0)}
            minSize={threeColumns ? 20 : 30}
          >
            {/* The container sits outside: Radix's scroll viewport sizes to its content */}
            <div className="@container h-full">
              <ScrollArea className="h-full">
                <div className="columns-1 gap-2 pr-1 @5xl:columns-2 @[110rem]:columns-3">
                  {rooms.map((room) => (
                    <RoomCard
                      key={room.projectId}
                      room={room}
                      meta={projectMeta.get(room.projectId)}
                      waiting={inbox.filter((t) => inboxProjectOf(t) === room.projectId).length}
                      deskFacts={deskFacts}
                      outdated={outdated}
                      selectedId={selected?.id ?? null}
                      onSelect={pickHere}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </Panel>
          {!left && divider}
          {!left && session}
          {!left && ownColumn && <PanelDivider />}
          {!left && ownColumn}
        </PanelGroup>
      )}
    </div>
  );
}
