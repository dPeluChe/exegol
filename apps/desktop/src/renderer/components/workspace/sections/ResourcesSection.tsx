import type { MetricsSnapshot } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Cpu, FolderGit2, GitBranch, HardDrive, MemoryStick, Server } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import {
  type SidecarSessionMemory,
  useAgents,
  useMetricsHistory,
  useProjectMetrics,
  useSidecarMemory,
  useSystemMetrics,
} from "../../../hooks/use-trpc";
import { EmptyState } from "../../common";
import { AgentProcessTable } from "./AgentProcessTable";
import { PtyMemoryCard } from "./PtyMemoryCard";
import { formatBytes, formatUptime, thresholdBarColor, thresholdColor } from "./resource-format";

// ─── Sparkline (inline SVG) ─────────────────────────────────────────────────

function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) {
    return <div style={{ width, height }} className="rounded bg-bg-tertiary" />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const pathD = `M${points.join(" L")}`;
  const areaD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      role="img"
      aria-label="Sparkline chart"
    >
      <defs>
        <linearGradient id={`sparkGrad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sparkGrad-${color})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  percent,
  detail,
  icon: Icon,
  sparkData,
}: {
  label: string;
  value: string;
  percent?: number;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  sparkData?: number[];
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        {percent !== undefined && (
          <span className={cn("text-xs font-bold tabular-nums", thresholdColor(percent))}>
            {percent.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-text-muted">{detail}</p>}
      {percent !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={cn("h-full rounded-full transition-all", thresholdBarColor(percent))}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
      {sparkData && sparkData.length > 1 && (
        <div className="mt-2">
          <Sparkline
            data={sparkData}
            width={160}
            height={28}
            color={
              percent !== undefined && percent >= 90
                ? "#ef4444"
                : percent !== undefined && percent >= 70
                  ? "#eab308"
                  : "var(--accent)"
            }
          />
        </div>
      )}
    </div>
  );
}
// ─── Main Section ───────────────────────────────────────────────────────────

export function ResourcesSection() {
  const { project, agents } = useProjectContext();
  const { data: systemMetrics } = useSystemMetrics();
  const { data: historyData } = useMetricsHistory();
  const { data: dbAgents } = useAgents(project?.id ?? null);
  const { data: sidecarMemory } = useSidecarMemory();

  const { data: projectMetrics, isLoading: projectLoading } = useProjectMetrics(
    project?.id ?? null,
    project?.path ?? null,
    project?.name ?? null,
  );

  // Live metrics from push events (T17)
  const [liveMetrics, setLiveMetrics] = useState<SystemMetricsEvent | null>(null);
  const historyRef = useRef<MetricsSnapshot[]>([]);

  // External system sync: IPC push events for live metrics (Rule 4)
  useMountEffect(() => {
    const cleanup = window.api.onMetrics((m) => {
      setLiveMetrics(m);
      // Append to local history for sparklines between tRPC refreshes
      historyRef.current = [
        ...historyRef.current.slice(-29),
        {
          cpu: m.cpu.usage,
          memoryPercent: m.memory.usagePercent,
          diskPercent: m.disk.usagePercent,
          timestamp: Date.now(),
        },
      ];
    });
    return cleanup;
  });

  // Merge: prefer pushed live metrics, fall back to tRPC query
  const metrics = liveMetrics ?? systemMetrics;
  const history = historyRef.current.length > 1 ? historyRef.current : (historyData ?? []);

  const cpuHistory = useMemo(() => history.map((h) => h.cpu), [history]);
  const memHistory = useMemo(() => history.map((h) => h.memoryPercent), [history]);

  const runningAgents = agents.filter((a) => a.status === "running" || a.status === "spawning");

  // Map agent IDs to their process metrics via PID
  const agentProcessMap = useMemo(() => {
    const map = new Map<string, { cpu: number; memory: number }>();
    if (!dbAgents || !projectMetrics?.agentProcesses) return map;
    for (const dbAgent of dbAgents) {
      if (!dbAgent.pid) continue;
      const proc = projectMetrics.agentProcesses.find((p) => p.pid === dbAgent.pid);
      if (proc) {
        map.set(dbAgent.id, { cpu: proc.cpu, memory: proc.memory });
      }
    }
    return map;
  }, [dbAgents, projectMetrics?.agentProcesses]);

  // T143: sidecar ring buffer memory per session, keyed by agent id (PTY
  // sessions are keyed by agent.id — see AgentManager.createSession call site)
  const ptyMemoryMap = useMemo(() => {
    const map = new Map<string, SidecarSessionMemory>();
    for (const s of sidecarMemory?.sessions ?? []) map.set(s.id, s);
    return map;
  }, [sidecarMemory]);

  if (!project) {
    return (
      <EmptyState
        icon={<Cpu className="h-8 w-8 text-text-muted" />}
        title="No project selected"
        description="Select a project to view resources"
        className="h-full"
      />
    );
  }

  const cpu = metrics?.cpu ?? { usage: 0, cores: 0, model: "Unknown" };
  const mem = metrics?.memory ?? { total: 0, used: 0, free: 0, usagePercent: 0 };
  const disk = metrics?.disk ?? { total: 0, used: 0, free: 0, usagePercent: 0 };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">System Resources</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              {cpu.model} \u00b7 {cpu.cores} cores \u00b7 uptime{" "}
              {formatUptime(metrics?.uptime ?? 0)}
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Live
          </div>
        </div>

        {/* System metrics grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            icon={Cpu}
            label="CPU"
            value={`${cpu.usage.toFixed(1)}%`}
            percent={cpu.usage}
            detail={`${cpu.cores} cores`}
            sparkData={cpuHistory}
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={`${formatBytes(mem.used)} / ${formatBytes(mem.total)}`}
            percent={mem.usagePercent}
            detail={`${formatBytes(mem.free)} available`}
            sparkData={memHistory}
          />
          <MetricCard
            icon={HardDrive}
            label="Disk"
            value={`${formatBytes(disk.used)} / ${formatBytes(disk.total)}`}
            percent={disk.usagePercent}
            detail={`${formatBytes(disk.free)} free`}
          />
          <PtyMemoryCard />
        </div>

        {/* Project stats */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Project: {project.name}
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <div className="flex items-center gap-2 text-text-muted">
                <Server className="h-4 w-4" />
                <span className="text-xs font-medium">Disk Usage</span>
              </div>
              <p className="mt-1 text-xl font-bold text-text-primary">
                {projectLoading ? "..." : formatBytes(projectMetrics?.diskUsage ?? 0)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <div className="flex items-center gap-2 text-text-muted">
                <GitBranch className="h-4 w-4" />
                <span className="text-xs font-medium">Worktrees</span>
              </div>
              <p className="mt-1 text-xl font-bold text-text-primary">
                {projectLoading ? "..." : String(projectMetrics?.worktreeCount ?? 1)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <div className="flex items-center gap-2 text-text-muted">
                <FolderGit2 className="h-4 w-4" />
                <span className="text-xs font-medium">Branch</span>
              </div>
              <p className="mt-1 text-xl font-bold text-text-primary">{project.defaultBranch}</p>
              <p className="mt-0.5 text-[10px] text-text-muted">
                {project.gitRemote ?? "No remote"}
              </p>
            </div>
          </div>
        </div>

        {/* Per-agent process table */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Active Agents ({runningAgents.length})
          </h4>
          <AgentProcessTable
            agents={runningAgents}
            agentProcessMap={agentProcessMap}
            ptyMemoryMap={ptyMemoryMap}
          />
        </div>
      </div>
    </div>
  );
}
