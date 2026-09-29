import type { MetricsSnapshot } from "@exegol/shared";
import { useMemo, useState } from "react";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import {
  type ProjectMetrics,
  type SidecarSessionMemory,
  useAgents,
  useMetricsHistory,
  useSidecarMemory,
  useSystemMetrics,
} from "../../../hooks/use-trpc";

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

/** Per-agent process metrics (matched by PID) and PTY ring-buffer memory, keyed by agent id. */
export function useAgentResourceMaps(
  projectId: string | null,
  agentProcesses: ProjectMetrics["agentProcesses"] | undefined,
) {
  const { data: dbAgents } = useAgents(projectId);
  const { data: sidecarMemory } = useSidecarMemory();

  // Map agent IDs to their process metrics via PID
  const agentProcessMap = useMemo(() => {
    const map = new Map<string, { cpu: number; memory: number }>();
    if (!dbAgents || !agentProcesses) return map;
    const byPid = new Map(agentProcesses.map((p) => [p.pid, p]));
    for (const dbAgent of dbAgents) {
      if (!dbAgent.pid) continue;
      const proc = byPid.get(dbAgent.pid);
      if (proc) {
        map.set(dbAgent.id, { cpu: proc.cpu, memory: proc.memory });
      }
    }
    return map;
  }, [dbAgents, agentProcesses]);

  // T143: sidecar ring buffer memory per session, keyed by agent id (PTY
  // sessions are keyed by agent.id — see AgentManager.createSession call site)
  const ptyMemoryMap = useMemo(() => {
    const map = new Map<string, SidecarSessionMemory>();
    for (const s of sidecarMemory?.sessions ?? []) map.set(s.id, s);
    return map;
  }, [sidecarMemory]);

  return { agentProcessMap, ptyMemoryMap };
}
