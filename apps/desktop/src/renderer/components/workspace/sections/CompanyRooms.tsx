import type { DeskFacts } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Globe } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useGitHubOverview } from "../../../hooks/use-trpc-github";
import { sessionName } from "../../../lib/agent-label";
import {
  type DeskState,
  deskActivity,
  deskState,
  groupByTab,
  type Room,
  shellCommand,
} from "../../../lib/company";
import { type AgentState, showProject, useAgentStore } from "../../../stores/agents";
import { useAppStore } from "../../../stores/app";
import { useDeskActivityStore } from "../../../stores/desk-activity";
import { useWorkspaceStore } from "../../../stores/workspace";
import { AgentIcon } from "../../common/AgentIcon";
import { GitHubCounts } from "../../common/GitHubCounts";
import type { ProjectMeta } from "../../common/ProjectChip";
import { DESK_STATE, StateLine } from "./DeskState";

const ROOM_SUMMARY: [DeskState, string][] = [
  ["needs", "need you"],
  ["working", "working"],
  ["stuck", "stuck"],
  ["unread", "unread"],
];

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
  const unseen = useAgentStore((s) => agent.id in s.unseenTurns);
  const state = deskState(agent, item, unseen);
  const activity = deskActivity(agent, item, lastActivity);
  const changed = facts?.changedFiles;
  const shell = agent.cliType === "shell";
  const command = shellCommand(agent);
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      aria-pressed={selected}
      data-desk-id={agent.id}
      aria-label={`${sessionName(agent)}, ${agent.cliType}, ${DESK_STATE[state].label}`}
      title={agent.branchName ?? undefined}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-bg-tertiary",
        shell ? "border-transparent bg-bg-tertiary/20" : "bg-bg-tertiary/40",
        !shell && DESK_STATE[state].ring,
        selected && "bg-accent/10 outline outline-1 outline-accent/60",
      )}
    >
      <AgentIcon provider={agent.cliType} size={shell ? 14 : 20} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">
            {sessionName(agent)}
          </span>
          {cliOutdated && <Tag>update</Tag>}
          {!!changed && <Tag tone="warn">±{changed}</Tag>}
          {facts?.port && <Tag>:{facts.port}</Tag>}
          {prNumber && <Tag>#{prNumber}</Tag>}
          {facts?.linked && <Tag>link</Tag>}
          {browser && (
            <Globe
              className="h-2.5 w-2.5 shrink-0 text-text-muted"
              aria-label="Browser beside it"
            />
          )}
        </span>
        {command ? (
          <span className="truncate text-[10px] text-green-400">{command}</span>
        ) : (
          <span className="truncate text-[10px] text-text-muted">
            <StateLine state={state} activitySince={agent.activitySince} />
            {activity && ` · ${activity}`}
          </span>
        )}
      </span>
    </button>
  );
});

export function RoomCard({
  room,
  meta,
  waiting,
  deskFacts,
  outdated,
  selectedId,
  onSelect,
}: {
  room: Room;
  meta: ProjectMeta | undefined;
  /** Inbox threads waiting on this project */
  waiting: number;
  deskFacts: Record<string, DeskFacts> | undefined;
  outdated: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { projectId, desks } = room;
  const attention = useAgentStore((s) => s.attentionItems);
  const unseen = useAgentStore((s) => s.unseenTurns);
  const { data: overview } = useGitHubOverview(projectId);
  const workspace = useWorkspaceStore((s) => s.projectWorkspaces[projectId]);
  const states = desks.map((a) => deskState(a, attention[a.id], a.id in unseen));
  const summary = ROOM_SUMMARY.map(
    ([state, label]) => [states.filter((s) => s === state).length, label] as const,
  )
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  const prs = overview?.prs ?? [];
  const groups = groupByTab(desks, workspace);
  const framed = groups.length > 1;

  return (
    <section className="mb-2 flex break-inside-avoid flex-col gap-1.5 rounded-lg border border-border bg-bg-secondary p-2">
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2.5 w-2.5 rounded-sm", !meta?.color && "bg-accent")}
          style={meta?.color ? { backgroundColor: meta.color } : undefined}
        />
        <h3 className="min-w-0 truncate text-xs font-semibold text-text-primary">
          {meta?.name ?? projectId.slice(0, 12)}
        </h3>
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted">{summary}</span>
        {waiting > 0 && (
          <button
            type="button"
            onClick={() => useAppStore.getState().openInbox(projectId)}
            className="shrink-0 rounded border border-warning/40 px-1.5 py-0.5 text-[10px] text-warning hover:bg-warning/10"
            title="Inbox threads waiting on this project"
          >
            {waiting} inbox
          </button>
        )}
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
      {groups.map((group) => (
        <div
          key={group.tabId ?? "none"}
          className={cn(framed && "rounded-md border border-dashed border-border/70 p-1")}
        >
          {framed && group.label && (
            <p className="truncate px-1 pb-0.5 text-[9px] text-text-muted">{group.label}</p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1">
            {group.desks.map((agent) => (
              <Desk
                key={agent.id}
                agent={agent}
                facts={deskFacts?.[agent.id]}
                prNumber={prs.find((p) => p.branch === agent.branchName)?.number}
                browser={group.browser}
                cliOutdated={outdated.has(agent.cliType)}
                selected={agent.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function TodayCard({
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
