import { cn } from "@exegol/ui";
import { TerminalSquare } from "lucide-react";
import { useSidecarMemory } from "../../../hooks/use-trpc-resources";
import { formatBytes, thresholdBarColor, thresholdColor } from "./resource-format";

/** T143: PTY count + ring buffer memory vs the sidecar's global cap. */
export function PtyMemoryCard() {
  const { data } = useSidecarMemory();

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <div className="flex items-center gap-2 text-text-muted">
          <TerminalSquare className="h-4 w-4" />
          <span className="text-xs font-medium">PTY Sessions</span>
        </div>
        <p className="mt-1 text-xl font-bold text-text-primary">—</p>
        <p className="mt-0.5 text-[10px] text-text-muted">Sidecar unavailable</p>
      </div>
    );
  }

  const percent =
    data.globalCapBytes > 0 ? (data.totalCapacityBytes / data.globalCapBytes) * 100 : 0;
  const evictedCount = data.sessions.filter((s) => s.evicted).length;

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-muted">
          <TerminalSquare className="h-4 w-4" />
          <span className="text-xs font-medium">PTY Sessions</span>
        </div>
        <span className={cn("text-xs font-bold tabular-nums", thresholdColor(percent))}>
          {percent.toFixed(1)}%
        </span>
      </div>
      <p className="mt-1 text-xl font-bold text-text-primary">{data.sessions.length}</p>
      <p className="mt-0.5 text-[10px] text-text-muted">
        {formatBytes(data.totalCapacityBytes)} / {formatBytes(data.globalCapBytes)} ring buffer
        {evictedCount > 0 ? ` · ${evictedCount} evicted (idle)` : ""}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className={cn("h-full rounded-full transition-all", thresholdBarColor(percent))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
