import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import { useSystemMetrics } from "../../hooks/use-trpc";

function barColor(pct: number): string {
  if (pct < 60) return "bg-green-500";
  if (pct < 85) return "bg-yellow-500";
  return "bg-red-500";
}

function MiniMetric({
  icon: Icon,
  label,
  percentage,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  percentage: number | undefined;
}) {
  const pct = percentage ?? 0;
  const loading = percentage === undefined;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-text-muted">
          <Icon className="h-2.5 w-2.5" />
          {label}
        </span>
        <span className="text-text-secondary">{loading ? "..." : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-[2px] w-full rounded-full bg-bg-tertiary">
        <div
          className={`h-full rounded-full transition-all ${loading ? "bg-bg-tertiary" : barColor(pct)}`}
          style={{ width: `${loading ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Global overview of host resources across all projects.
 * Shows in the sidebar as a collapsible section.
 */
export function ResourcesOverview() {
  const { data: metrics } = useSystemMetrics();

  return (
    <div className="space-y-1.5">
      <MiniMetric icon={Cpu} label="CPU" percentage={metrics?.cpu.usage} />
      <MiniMetric icon={MemoryStick} label="Memory" percentage={metrics?.memory.usagePercent} />
      <MiniMetric icon={HardDrive} label="Disk" percentage={metrics?.disk.usagePercent} />
    </div>
  );
}
