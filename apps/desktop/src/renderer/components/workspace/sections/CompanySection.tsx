import type { DeskFacts, DoneSession } from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactNode, useMemo, useRef, useState } from "react";
import { type ImperativePanelHandle, Panel, PanelGroup } from "react-resizable-panels";
import { useCliUpdates } from "../../../hooks/use-cli-updates";
import { useCompanyKeys } from "../../../hooks/use-company-keys";
import { useNow } from "../../../hooks/use-now";
import { useGitHubOverview } from "../../../hooks/use-trpc-github";
import { sessionName } from "../../../lib/agent-label";
import {
  besideBrowser,
  buildRooms,
  type DeskState,
  deskActivity,
  deskState,
  nextNeedsYou,
  type Room,
  todayStrip,
} from "../../../lib/company";
import { formatTimeAgo } from "../../../lib/format";
import { trpcInvoke } from "../../../lib/trpc-client";
import { type AgentState, showProject, useAgentStore } from "../../../stores/agents";
import { type CompanyView, useAppStore } from "../../../stores/app";
import { useDeskActivityStore } from "../../../stores/desk-activity";
import { useNotificationPrefsStore } from "../../../stores/notification-prefs";
import { useWorkspaceStore } from "../../../stores/workspace";
import { AgentIcon } from "../../common/AgentIcon";
import { GitHubCounts } from "../../common/GitHubCounts";
import { PanelDivider } from "../../common/PanelDivider";
import type { ProjectMeta } from "../../common/ProjectChip";
import { CompanySession } from "./CompanySession";

const DESK_STATE: Record<DeskState, { label: string; color: string; ring: string }> = {
  needs: {
    label: "needs you",
    color: "text-amber-400",
    ring: "border-amber-400/60 motion-safe:animate-pulse",
  },
  stuck: { label: "stuck", color: "text-error", ring: "border-error/60" },
  working: { label: "working", color: "text-green-400", ring: "border-green-500/40" },
  idle: { label: "waiting", color: "text-text-muted", ring: "border-border" },
  suspended: { label: "suspended", color: "text-text-muted", ring: "border-border opacity-60" },
};

const ROOM_SUMMARY: [DeskState, string][] = [
  ["needs", "need you"],
  ["working", "working"],
  ["stuck", "stuck"],
];

const whereOf = (a: AgentState) => a.branchName ?? "repo root";

/** Leaf timer: only this line re-renders as time passes */
function StateLine({ state, activitySince }: { state: DeskState; activitySince?: number }) {
  useNow();
  const ago = activitySince && state !== "suspended" ? formatTimeAgo(activitySince / 1000) : "";
  return (
    <span className={cn("text-[10px]", DESK_STATE[state].color)}>
      {DESK_STATE[state].label}
      {ago && ago !== "now" ? ` ${ago}` : ""}
    </span>
  );
}

function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded px-1 text-[9px]",
        tone === "warn" ? "bg-amber-400/10 text-amber-400" : "bg-white/5 text-text-muted",
      )}
    >
      {children}
    </span>
  );
}

// Memo: a push about one session redraws its own desk, not the room
const Desk = memo(function Desk({
  agent,
  facts,
  prNumber,
  browser,
  cliOutdated,
  selected,
  onSelect,
}: {
  agent: AgentState;
  facts: DeskFacts | undefined;
  prNumber: number | undefined;
  browser: boolean;
  cliOutdated: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const item = useAgentStore((s) => s.attentionItems[agent.id]);
  const lastActivity = useDeskActivityStore((s) => s.activity[agent.id]);
  const state = deskState(agent, item);
  const activity = deskActivity(agent, item, lastActivity);
  const changed = facts?.changedFiles;
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      aria-pressed={selected}
      data-desk-id={agent.id}
      aria-label={`${sessionName(agent)}, ${agent.cliType}, ${DESK_STATE[state].label}`}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 rounded-lg border bg-bg-tertiary/40 px-1.5 py-2 transition-colors hover:bg-bg-tertiary",
        DESK_STATE[state].ring,
        selected && "bg-accent/10 outline outline-1 outline-accent/60",
      )}
    >
      <span className="h-3.5 text-[9px] uppercase tracking-wider text-text-muted">{activity}</span>
      <AgentIcon provider={agent.cliType} size={22} />
      <span className="h-1 w-10 rounded-sm bg-border" aria-hidden="true" />
      <span className="max-w-full truncate text-[11px] text-text-primary">
        {sessionName(agent)}
      </span>
      <span className="max-w-full truncate text-[10px] text-text-muted">{whereOf(agent)}</span>
      <StateLine state={state} activitySince={agent.activitySince} />
      <span className="flex min-h-[14px] flex-wrap justify-center gap-0.5">
        {cliOutdated && <Tag>CLI update</Tag>}
        {changed === 0 && <Tag>clean</Tag>}
        {!!changed && <Tag tone="warn">±{changed}</Tag>}
        {facts?.port && <Tag>:{facts.port}</Tag>}
        {browser && <Tag>browser</Tag>}
        {prNumber && <Tag>PR #{prNumber}</Tag>}
        {facts?.linked && <Tag>link</Tag>}
      </span>
    </button>
  );
});

function RoomCard({
  room,
  meta,
  deskFacts,
  outdated,
  selectedId,
  onSelect,
}: {
  room: Room;
  meta: ProjectMeta | undefined;
  deskFacts: Record<string, DeskFacts> | undefined;
  outdated: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { projectId, desks } = room;
  const attention = useAgentStore((s) => s.attentionItems);
  const { data: overview } = useGitHubOverview(projectId);
  const workspace = useWorkspaceStore((s) => s.projectWorkspaces[projectId]);
  const browsers = useMemo(() => besideBrowser(workspace), [workspace]);
  const states = desks.map((a) => deskState(a, attention[a.id]));
  const summary = ROOM_SUMMARY.map(
    ([state, label]) => [states.filter((s) => s === state).length, label] as const,
  )
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  const prs = overview?.prs ?? [];

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2.5 w-2.5 rounded-sm", !meta?.color && "bg-accent")}
          style={meta?.color ? { backgroundColor: meta.color } : undefined}
        />
        <h3 className="min-w-0 truncate text-xs font-semibold text-text-primary">
          {meta?.name ?? projectId.slice(0, 12)}
        </h3>
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted">{summary}</span>
        <GitHubCounts prs={prs} issues={overview?.issues ?? []} />
        <button
          type="button"
          onClick={() => showProject(projectId)}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-accent/40"
          title="Go to this project and its layouts"
        >
          Open project
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-bg-tertiary/20 p-1.5 @xl:grid-cols-3">
        {desks.map((agent) => (
          <Desk
            key={agent.id}
            agent={agent}
            facts={deskFacts?.[agent.id]}
            prNumber={prs.find((p) => p.branch === agent.branchName)?.number}
            browser={browsers.has(agent.id)}
            cliOutdated={outdated.has(agent.cliType)}
            selected={agent.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function TodayCard({
  label,
  tone,
  agents,
  onClick,
}: {
  label: string;
  tone: string;
  agents: Pick<AgentState, "alias" | "taskDescription" | "cliType">[];
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("text-[10px] uppercase tracking-wider", tone)}>
        {label} · {agents.length}
      </span>
      <span className="truncate text-[11px] text-text-secondary">
        {agents.slice(0, 3).map(sessionName).join(", ") || "Nothing"}
      </span>
    </>
  );
  const className =
    "flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-left";
  return onClick && agents.length > 0 ? (
    <button type="button" onClick={onClick} className={cn(className, "hover:border-accent/40")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Cross-project offices: a room per project with live sessions, a desk per session */
export function CompanySection({ projectMeta }: { projectMeta: Map<string, ProjectMeta> }) {
  const agents = useAgentStore((s) => s.agents);
  const attention = useAgentStore((s) => s.attentionItems);
  const levelOf = useNotificationPrefsStore((s) => s.levelOf);
  // Subscribed for its changes: `levelOf` itself is one stable function
  useNotificationPrefsStore((s) => s.interruption);
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

  const rooms = buildRooms(Object.values(agents), attention);
  const today = todayStrip(Object.values(agents), attention, { levelOf, outdated });
  const [pickedId, setPickedId] = useState<string | null>(null);
  const live = rooms.flatMap((r) => r.desks);
  const selected =
    live.find((a) => a.id === pickedId) ?? today.needs[0] ?? today.stuck[0] ?? live[0];
  const pickNext = () => {
    const next = nextNeedsYou(
      today.needs.map((a) => a.id),
      selected?.id ?? null,
    );
    if (next) setPickedId(next);
  };

  useCompanyKeys({ pickNext, selected, live });

  const sessionPanel = useRef<ImperativePanelHandle>(null);
  const [view, setView] = useState<CompanyView>("chat");
  const side = useAppStore((s) => s.companySessionSide);
  const pickView = (next: CompanyView) => {
    setView(next);
    sessionPanel.current?.resize(useAppStore.getState().companySessionSizes[next]);
  };
  const keepSize = (dragging: boolean) => {
    const size = sessionPanel.current?.getSize();
    if (!dragging && size) useAppStore.getState().setCompanySessionSize(view, size);
  };
  // Read as a Panel mounts: later widths come from dragging or `pickView`
  const sessionSize = useAppStore.getState().companySessionSizes[view];
  const divider = selected && <PanelDivider onDragging={keepSize} />;
  const session = selected && (
    <Panel
      ref={sessionPanel}
      id="session"
      order={side === "left" ? 1 : 2}
      defaultSize={sessionSize}
      minSize={20}
      maxSize={70}
    >
      <CompanySession
        key={selected.id}
        agent={selected}
        where={`${projectMeta.get(selected.projectId)?.name ?? ""} · ${whereOf(selected)}`}
        picked={view}
        onPick={pickView}
      />
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
        <p className="py-8 text-center text-xs text-text-muted">No live sessions right now.</p>
      ) : (
        // Keyed: the panels change order, so the group starts over from the stored widths
        <PanelGroup key={side} direction="horizontal" className="min-h-0 flex-1">
          {side === "left" && session}
          {side === "left" && divider}
          <Panel
            id="rooms"
            order={side === "left" ? 2 : 1}
            defaultSize={100 - sessionSize}
            minSize={30}
          >
            {/* The container sits outside: Radix's scroll viewport sizes to its content */}
            <div className="@container h-full">
              <ScrollArea className="h-full">
                <div className="grid grid-cols-1 gap-3 pr-1 @5xl:grid-cols-2">
                  {rooms.map((room) => (
                    <RoomCard
                      key={room.projectId}
                      room={room}
                      meta={projectMeta.get(room.projectId)}
                      deskFacts={deskFacts}
                      outdated={outdated}
                      selectedId={selected?.id ?? null}
                      onSelect={setPickedId}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </Panel>
          {side === "right" && divider}
          {side === "right" && session}
        </PanelGroup>
      )}
    </div>
  );
}
