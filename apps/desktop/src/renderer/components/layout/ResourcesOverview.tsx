import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import { useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useSystemMetrics } from "../../hooks/use-trpc";
import type { SystemMetrics } from "../../hooks/use-trpc-resources";

function barColor(pct: number): string {
  if (pct < 60) return "bg-green-500";
  if (pct < 85) return "bg-yellow-500";
  return "bg-red-500";
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;

function MiniMetric({
  icon: Icon,
  label,
  percentage,
  of,
  detail,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  percentage: number | undefined;
  /** What the percentage is of: "12 cores", "14.7 of 32 GB" */
  of?: string;
  /** Exegol's and the agents' share */
  detail?: string;
  title?: string;
}) {
  const pct = percentage ?? 0;
  const loading = percentage === undefined;

  return (
    <div className="space-y-0.5" title={title}>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="flex shrink-0 items-center gap-1 text-text-muted">
          <Icon className="h-2.5 w-2.5" />
          {label}
        </span>
        <span className="min-w-0 truncate text-text-secondary">
          {loading ? "..." : `${pct.toFixed(0)}%`}
          {!loading && of && <span className="text-text-muted"> · {of}</span>}
        </span>
      </div>
      <div className="h-[2px] w-full rounded-full bg-bg-tertiary">
        <div
          className={`h-full rounded-full transition-all ${loading ? "bg-bg-tertiary" : barColor(pct)}`}
          style={{ width: `${loading ? 0 : pct}%` }}
        />
      </div>
      {detail && <p className="truncate text-[9px] text-text-muted">{detail}</p>}
    </div>
  );
}

/**
 * Global overview of host resources across all projects.
 * Shows in the sidebar as a collapsible section.
 */
export function ResourcesOverview() {
  const { data: queryMetrics } = useSystemMetrics();
  const [liveMetrics, setLiveMetrics] = useState<SystemMetrics | null>(null);
  const prevRef = useRef({ cpu: -1, mem: -1, disk: -1 });

  useMountEffect(() => {
    return window.api.onMetrics((m) => {
      const cpu = m.cpu.usage;
      const mem = m.memory.usagePercent;
      const disk = m.disk.usagePercent;
      if (
        cpu !== prevRef.current.cpu ||
        mem !== prevRef.current.mem ||
        disk !== prevRef.current.disk
      ) {
        prevRef.current = { cpu, mem, disk };
        setLiveMetrics(m as SystemMetrics);
      }
    });
  });

  const metrics = liveMetrics ?? queryMetrics;
  const u = metrics?.usage;

  return (
    <div className="space-y-1.5">
      <MiniMetric
        icon={Cpu}
        label="CPU"
        percentage={metrics?.cpu.usage}
        of={metrics ? `${metrics.cpu.cores} cores` : undefined}
        detail={u ? `Exegol ${u.exegolCpu}% · agents ${u.agentsCpu}%` : undefined}
        title={
          metrics
            ? `Whole machine, all ${metrics.cpu.cores} cores (${metrics.cpu.model})`
            : undefined
        }
      />
      <MiniMetric
        icon={MemoryStick}
        label="Memory"
        percentage={metrics?.memory.usagePercent}
        of={metrics ? `${gb(metrics.memory.used)} of ${gb(metrics.memory.total)}` : undefined}
        detail={
          u
            ? `Exegol ${gb(u.exegolMemory)} · agents ${gb(u.agentsMemory)} (${u.agentProcesses} proc.)`
            : undefined
        }
        title="Whole machine. Agents are the CLIs Exegol runs (claude, devin...) and their children; suspend or close idle sessions to free it"
      />
      <MiniMetric
        icon={HardDrive}
        label="Disk"
        percentage={metrics?.disk.usagePercent}
        of={
          metrics
            ? `${gb(metrics.disk.total - metrics.disk.free)} of ${gb(metrics.disk.total)}`
            : undefined
        }
        title="Your data volume (on macOS / is the read-only system volume)"
      />
    </div>
  );
}
