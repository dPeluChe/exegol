import type { AgentStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";
import type { SidecarSessionMemory } from "../../../hooks/use-trpc-resources";
import { StatusDot } from "../../common";
import { formatBytes, formatUptime, thresholdColor } from "./resource-format";

export function AgentProcessTable({
  agents,
  agentProcessMap,
  ptyMemoryMap,
}: {
  agents: {
    id: string;
    cliType: string;
    taskDescription: string;
    status: string;
    startedAt: number | null;
  }[];
  agentProcessMap: Map<string, { cpu: number; memory: number }>;
  ptyMemoryMap?: Map<string, SidecarSessionMemory>;
}) {
  const now = Math.floor(Date.now() / 1000);

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
        <p className="text-xs text-text-muted">No agents currently running</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-bg-tertiary text-text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Agent</th>
            <th className="px-3 py-2 text-left font-medium">Task</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">CPU</th>
            <th className="px-3 py-2 text-right font-medium">Memory</th>
            <th className="px-3 py-2 text-right font-medium">Ring Buffer</th>
            <th className="px-3 py-2 text-right font-medium">Uptime</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((agent) => {
            const proc = agentProcessMap.get(agent.id);
            const pty = ptyMemoryMap?.get(agent.id);
            const uptime = agent.startedAt ? now - agent.startedAt : 0;
            const cpuVal = proc?.cpu ?? 0;
            return (
              <tr key={agent.id} className="bg-bg-secondary text-text-secondary">
                <td className="px-3 py-2">
                  <span className="font-medium text-text-primary">{agent.cliType}</span>
                </td>
                <td className="max-w-[200px] truncate px-3 py-2">{agent.taskDescription}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary">
                    <StatusDot status={agent.status as AgentStatus} size="sm" />
                    {agent.status}
                  </span>
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", thresholdColor(cpuVal))}>
                  {proc ? `${cpuVal.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {proc ? formatBytes(proc.memory) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                  {pty ? (pty.evicted ? "evicted (idle)" : formatBytes(pty.capacityBytes)) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                  {uptime > 0 ? formatUptime(uptime) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
