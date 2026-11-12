import type { MetricsSnapshot } from "@exegol/shared";
import { useMemo, useState } from "react";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { useMetricsHistory, useSystemMetrics } from "../../../hooks/use-trpc";

/** System metrics: pushed live values first, the tRPC query as fallback, plus sparkline series. */
export function useLiveSystemMetrics() {
  const { data: systemMetrics } = useSystemMetrics();
  const { data: historyData } = useMetricsHistory();

  // Live metrics from push events (T17)
  const [liveMetrics, setLiveMetrics] = useState<SystemMetricsEvent | null>(null);
  const [liveHistory, setLiveHistory] = useState<MetricsSnapshot[]>([]);

  // External system sync: IPC push events for live metrics (Rule 4)
  useMountEffect(() => {
    const cleanup = window.api.onMetrics((m) => {
      setLiveMetrics(m);
      // Append to local history for sparklines between tRPC refreshes
      setLiveHistory((prev) => [
        ...prev.slice(-29),
        {
          cpu: m.cpu.usage,
          memoryPercent: m.memory.usagePercent,
          diskPercent: m.disk.usagePercent,
          timestamp: Date.now(),
        },
      ]);
    });
    return cleanup;
  });

  // Merge: prefer pushed live metrics, fall back to tRPC query
  const metrics = liveMetrics ?? systemMetrics;
  const history = useMemo(
    () => (liveHistory.length > 1 ? liveHistory : (historyData ?? [])),
    [liveHistory, historyData],
  );

  const cpuHistory = useMemo(() => history.map((h) => h.cpu), [history]);
  const memHistory = useMemo(() => history.map((h) => h.memoryPercent), [history]);

  return { metrics, cpuHistory, memHistory };
}
