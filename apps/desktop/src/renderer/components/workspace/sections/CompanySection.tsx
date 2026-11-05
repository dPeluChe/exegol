import type { DeskFacts, GitHubPr } from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { useCliUpdates } from "../../../hooks/use-cli-updates";
import { useLatest } from "../../../hooks/use-latest";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { useNow } from "../../../hooks/use-now";
import { useGitHubOverview } from "../../../hooks/use-trpc-github";
import {
  buildRooms,
  type DeskActivity,
  type DeskState,
  deskActivity,
  deskState,
  nextNeedsYou,
  todayStrip,
} from "../../../lib/company";
import { isTextField } from "../../../lib/ended-session";
import { trpcInvoke } from "../../../lib/trpc-client";
import {
  type AgentState,
  type AttentionItem,
  jumpToAgent,
  showProject,
  useAgentStore,
} from "../../../stores/agents";
import { useAppStore } from "../../../stores/app";
import { useNotificationPrefsStore } from "../../../stores/notification-prefs";
import { collectPaneIds, useWorkspaceStore } from "../../../stores/workspace";
import { AgentIcon } from "../../common/AgentIcon";
import type { ProjectMeta } from "../../common/ProjectChip";
import { CompanySession } from "./CompanySession";

const STATE_LABEL: Record<DeskState, string> = {
  needs: "needs you",
  stuck: "stuck",
  working: "working",
  idle: "waiting",
  suspended: "suspended",
};

const STATE_COLOR: Record<DeskState, string> = {
  needs: "text-amber-400",
  stuck: "text-error",
  working: "text-green-400",
  idle: "text-text-muted",
  suspended: "text-text-muted",
};

const DESK_RING: Record<DeskState, string> = {
  needs: "border-amber-400/60 motion-safe:animate-pulse",
  stuck: "border-error/60",
  working: "border-green-500/40",
  idle: "border-border",
  suspended: "border-border opacity-60",
};

const ACTIVITY_LABEL: Record<DeskActivity, string> = {
  edits: "EDITS",
  command: "COMMAND",
  browser: "BROWSER",
  thinking: "THINKING",
  question: "QUESTION",
  message: "MESSAGE",
};

const sessionName = (a: AgentState) => a.alias || a.taskDescription.slice(0, 40) || a.cliType;
const whereOf = (a: AgentState) => a.branchName ?? "repo root";

function since(ms: number | undefined, now: number): string {
  if (!ms) return "";
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "";
  return minutes < 60 ? ` ${minutes}m` : ` ${Math.floor(minutes / 60)}h`;
}

/** Leaf timer: only this line re-renders as time passes */
function StateLine({ state, activitySince }: { state: DeskState; activitySince?: number }) {
  const now = useNow();
  return (
    <span className={cn("text-[10px]", STATE_COLOR[state])}>
      {STATE_LABEL[state]}
      {state === "suspended" ? "" : since(activitySince, now)}
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

function Desk({
  agent,
  item,
  tool,
  facts,
  pr,
  browser,
  cliOutdated,
  selected,
  onSelect,
}: {
  agent: AgentState;
  item: AttentionItem | undefined;
  tool: string | undefined;
  facts: DeskFacts | undefined;
  pr: GitHubPr | undefined;
  browser: boolean;
  cliOutdated: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = deskState(agent, item);
  const activity = deskActivity(agent, item, tool);
  const changed = facts?.changedFiles;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-desk-id={agent.id}
      aria-label={`${sessionName(agent)}, ${agent.cliType}, ${STATE_LABEL[state]}`}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 rounded-lg border bg-bg-tertiary/40 px-1.5 py-2 transition-colors hover:bg-bg-tertiary",
        DESK_RING[state],
        selected && "bg-accent/10 outline outline-1 outline-accent/60",
      )}
    >
      <span className="h-3.5 text-[9px] tracking-wider text-text-muted">
        {activity ? ACTIVITY_LABEL[activity] : ""}
      </span>
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
        {pr && <Tag>PR #{pr.number}</Tag>}
        {!!facts?.linkedTo.length && <Tag>link</Tag>}
      </span>
    </button>
  );
}

function RoomCard({
  projectId,
  meta,
  desks,
  deskFacts,
  outdated,
  selectedId,
  onSelect,
}: {
  projectId: string;
  meta: ProjectMeta | undefined;
  desks: AgentState[];
  deskFacts: Record<string, DeskFacts> | undefined;
  outdated: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const attention = useAgentStore((s) => s.attentionItems);
  const tools = useAgentStore((s) => s.activityTools);
  const { data: overview } = useGitHubOverview(projectId);
  const workspace = useWorkspaceStore((s) => s.projectWorkspaces[projectId]);
  const besideBrowser = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of workspace?.tabs ?? []) {
      const panes = collectPaneIds(tab.layout).map((id) => workspace?.panes[id]);
      if (!panes.some((p) => p?.type === "browser")) continue;
      for (const p of panes) if (p?.agentId) ids.add(p.agentId);
    }
    return ids;
  }, [workspace]);
  const states = desks.map((a) => deskState(a, attention[a.id]));
  const count = (state: DeskState) => states.filter((s) => s === state).length;
  const summary = [
    count("needs") && `${count("needs")} need you`,
    count("working") && `${count("working")} working`,
    count("stuck") && `${count("stuck")} stuck`,
  ]
    .filter(Boolean)
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
        <span className="truncate text-[10px] text-text-muted">{summary}</span>
        {prs.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] text-text-muted">{prs.length} PR</span>
        )}
        <button
          type="button"
          onClick={() => showProject(projectId)}
          className={cn(
            "shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-accent/40",
            prs.length === 0 && "ml-auto",
          )}
          title="Go to this project and its layouts"
        >
          Open project
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-bg-tertiary/20 p-1.5 xl:grid-cols-3">
        {desks.map((agent) => (
          <Desk
            key={agent.id}
            agent={agent}
            item={attention[agent.id]}
            tool={tools[agent.id]}
            facts={deskFacts?.[agent.id]}
            pr={agent.branchName ? prs.find((p) => p.branch === agent.branchName) : undefined}
            browser={besideBrowser.has(agent.id)}
            cliOutdated={outdated.has(agent.cliType)}
            selected={agent.id === selectedId}
            onSelect={() => onSelect(agent.id)}
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
  agents: AgentState[];
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

/** A key may act unless the user is typing, the mirror's own textarea included, or a dialog is up */
function companyKeysAllowed(active: HTMLElement | null): boolean {
  if (document.querySelector('[role="dialog"]')) return false;
  return !active || active === document.body || !isTextField(active);
}

/** Cross-project offices: a room per project with live sessions, a desk per session */
export function CompanySection({
  agents,
  projectMeta,
}: {
  agents: AgentState[];
  projectMeta: Map<string, ProjectMeta>;
}) {
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
  useMountEffect(() => () => useAppStore.getState().setCompanySeenAt(Date.now()));

  const { data: deskFacts } = useQuery({
    queryKey: ["agents", "deskFacts"],
    queryFn: () => trpcInvoke<Record<string, DeskFacts>>("agents.deskFacts"),
    refetchInterval: 15_000,
  });

  const rooms = useMemo(() => buildRooms(agents), [agents]);
  const today = todayStrip(agents, attention, { levelOf, outdated, since: seenAt });
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

  const keys = useLatest({ pickNext, selected, live });
  useMountEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (!companyKeysAllowed(active)) return;
      const { pickNext, selected, live } = keys.current;
      if (e.key.toLowerCase() === "p") {
        pickNext();
      } else if (e.key === "Enter") {
        // A desk in focus is the one meant; any other button keeps its own Enter
        const deskId = active?.dataset.deskId;
        if (!deskId && active?.closest("button, a")) return;
        const target = live.find((a) => a.id === deskId) ?? selected;
        if (!target) return;
        jumpToAgent(target.id, target.projectId);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

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
        <TodayCard label="Done since you left" tone="text-green-400" agents={today.done} />
      </div>
      {rooms.length === 0 ? (
        <p className="py-8 text-center text-xs text-text-muted">No live sessions right now.</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <ScrollArea className="min-w-0 flex-1">
            <div className="grid grid-cols-1 gap-3 pr-1 xl:grid-cols-2">
              {rooms.map((room) => (
                <RoomCard
                  key={room.projectId}
                  projectId={room.projectId}
                  meta={projectMeta.get(room.projectId)}
                  desks={room.desks}
                  deskFacts={deskFacts}
                  outdated={outdated}
                  selectedId={selected?.id ?? null}
                  onSelect={setPickedId}
                />
              ))}
            </div>
          </ScrollArea>
          {selected && (
            <CompanySession
              agent={selected}
              where={`${projectMeta.get(selected.projectId)?.name ?? ""} · ${whereOf(selected)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
