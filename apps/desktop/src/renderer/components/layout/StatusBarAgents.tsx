import { acceptsFollowUps, type PrWatchStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  ListPlus,
  Play,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { useNow } from "../../hooks/use-now";
import { useProjects } from "../../hooks/use-trpc";
import { AGENT_GROUP_ORDER, type AgentGroup, groupAgents } from "../../lib/agent-groups";
import { sessionName } from "../../lib/agent-label";
import { isLongWait, turnTime } from "../../lib/busy-time";
import { trpcInvoke } from "../../lib/trpc-client";
import { type AgentState, jumpToAgent, useAgentStore } from "../../stores/agents";
import { AgentIcon } from "../common/AgentIcon";
import { StatusDot } from "../common/StatusDot";
import { useFollowUps } from "../terminal/FollowUpControl";
import { prWatchStatusKey } from "../terminal/PrWatchControl";
import { formatUptime } from "../workspace/sections/resource-format";

const GROUP_LABEL: Record<AgentGroup, string> = {
  needYou: "Need you",
  working: "Working",
  waiting: "Waiting",
};

/** Opens away from the bar it sits in: up from the footer, down from the title bar */
const menuY = (rect: DOMRect) =>
  rect.top > window.innerHeight / 2 ? rect.top - 4 : rect.bottom + 4;

/** Counts per group; the popover lists the sessions and jumps to one */
export function AgentsWidget() {
  const agents = useAgentStore((s) => s.agents);
  const attention = useAgentStore((s) => s.attentionItems);
  const groups = useMemo(() => groupAgents(Object.values(agents), attention), [agents, attention]);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useFittedMenu(menuRef, anchor);
  const total = groups.needYou.length + groups.working.length + groups.waiting.length;
  if (total === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: rect.left, y: menuY(rect) });
        }}
        className="flex shrink-0 items-center gap-1.5 rounded px-1 tabular-nums hover:bg-white/10 hover:text-text-secondary"
        title="Sessions by state: click for the list"
      >
        {groups.needYou.length > 0 && (
          <>
            <span className="flex items-center gap-0.5 text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {groups.needYou.length} need you
            </span>
            <span>·</span>
          </>
        )}
        <span
          className={cn("flex items-center gap-0.5", groups.working.length > 0 && "text-success")}
        >
          <Play className="h-2.5 w-2.5" />
          {groups.working.length} working
        </span>
        <span>·</span>
        <span>{groups.waiting.length} waiting</span>
      </button>
      {anchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setAnchor(null)}
              onKeyDown={() => {}}
              role="none"
            />
            <div
              ref={menuRef}
              className="fixed z-[101] w-96 rounded-lg border border-border bg-bg-secondary p-1.5 text-[11px] shadow-2xl"
              style={menuStyle}
            >
              <AgentsPanel groups={groups} onPick={() => setAnchor(null)} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function AgentsPanel({
  groups,
  onPick,
}: {
  groups: Record<AgentGroup, AgentState[]>;
  onPick: () => void;
}) {
  const [waitingOpen, setWaitingOpen] = useState(true);
  const { data: projects = [] } = useProjects();
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  return (
    <div className="space-y-1.5">
      {AGENT_GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => {
        const collapsible = g === "waiting";
        const open = !collapsible || waitingOpen;
        return (
          <div key={g}>
            <button
              type="button"
              disabled={!collapsible}
              onClick={() => setWaitingOpen(!waitingOpen)}
              className="flex w-full items-center gap-1 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-muted"
            >
              {collapsible &&
                (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
              {GROUP_LABEL[g]} · {groups[g].length}
            </button>
            {open &&
              groups[g].map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  project={projectName.get(a.projectId) ?? "?"}
                  onPick={onPick}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function AgentRow({
  agent,
  project,
  onPick,
}: {
  agent: AgentState;
  project: string;
  onPick: () => void;
}) {
  const now = useNow();
  const item = useAgentStore((s) => s.attentionItems[agent.id]);
  const followUps = useFollowUps(agent.id, acceptsFollowUps(agent));
  const { data: pr } = useQuery({
    queryKey: prWatchStatusKey(agent.id),
    queryFn: () => trpcInvoke<PrWatchStatus>("agents.prWatchStatus", { id: agent.id }),
    enabled: !!agent.prWatch,
  });
  const prProblem = !!agent.prWatch && !!pr?.pr && (pr.pr.failingChecks > 0 || pr.pr.conflicting);
  const alert = item && !item.read && item.level !== "action_needed" ? item : null;
  const t = turnTime(agent, now);

  return (
    <button
      type="button"
      onClick={() => {
        jumpToAgent(agent.id, agent.projectId);
        onPick();
      }}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-white/5"
    >
      <StatusDot status={agent.status} activityLevel={agent.activityLevel} size="sm" />
      <AgentIcon provider={agent.cliType} size={12} />
      <span className="min-w-0 flex-1 truncate text-text-primary">{sessionName(agent)}</span>
      <span className="max-w-28 shrink-0 truncate text-text-muted">{project}</span>
      {followUps.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-accent"
          title={`${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} queued`}
        >
          <ListPlus className="h-3 w-3" />
          {followUps.length}
        </span>
      )}
      {prProblem && (
        <span className="shrink-0 text-error" title="Its PR has failing checks or conflicts">
          <GitPullRequest className="h-3 w-3" />
        </span>
      )}
      {alert && (
        <span className="shrink-0 text-amber-400" title={alert.reason}>
          <Bell className="h-3 w-3" />
        </span>
      )}
      <span
        className={cn(
          "w-12 shrink-0 text-right tabular-nums",
          isLongWait(agent, now) ? "text-amber-400" : "text-text-muted",
        )}
      >
        {t ? formatUptime(t.seconds) : ""}
      </span>
    </button>
  );
}
