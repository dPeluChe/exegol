import { cn } from "@exegol/ui";
import { FolderGit2, GitBranch, HardDrive } from "lucide-react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useProjectMetrics } from "../../../hooks/use-trpc";
import { useAgentStore } from "../../../stores/agents";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── Components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-2 text-text-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-text-muted">{detail}</p>}
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function ResourcesSection() {
  const { project, agents } = useProjectContext();
  const _allAgents = useAgentStore((s) => s.agents);

  const { data: projectMetrics, isLoading } = useProjectMetrics(
    project?.id ?? null,
    project?.path ?? null,
    project?.name ?? null,
  );

  const projectAgents = agents;
  const runningAgents = projectAgents.filter(
    (a) => a.status === "running" || a.status === "spawning",
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Select a project to view resources</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Project header */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{project.name}</h3>
          <p className="mt-0.5 text-xs text-text-muted">{project.path}</p>
        </div>

        {/* Project stats grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={HardDrive}
            label="Disk Usage"
            value={isLoading ? "Calculating..." : formatBytes(projectMetrics?.diskUsage ?? 0)}
            detail="Total project directory size"
          />
          <StatCard
            icon={GitBranch}
            label="Worktrees"
            value={isLoading ? "..." : String(projectMetrics?.worktreeCount ?? 1)}
            detail="Active git worktrees"
          />
          <StatCard
            icon={FolderGit2}
            label="Branch"
            value={project.defaultBranch}
            detail={project.gitRemote ?? "No remote"}
          />
        </div>

        {/* Running agents */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Active Agents ({runningAgents.length})
          </h4>

          {runningAgents.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-bg-tertiary text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Agent</th>
                    <th className="px-3 py-2 text-left font-medium">Task</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Current Step</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runningAgents.map((agent) => (
                    <tr key={agent.id} className="bg-bg-secondary text-text-secondary">
                      <td className="px-3 py-2">
                        <span className="font-medium text-text-primary">{agent.cliType}</span>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2">{agent.taskDescription}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            agent.status === "running" && "bg-green-500/10 text-green-400",
                            agent.status === "spawning" && "bg-blue-500/10 text-blue-400",
                            agent.status === "waiting_input" && "bg-yellow-500/10 text-yellow-400",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              agent.status === "running" && "bg-green-500",
                              agent.status === "spawning" && "bg-blue-500",
                              agent.status === "waiting_input" && "bg-yellow-500",
                            )}
                          />
                          {agent.status}
                        </span>
                      </td>
                      <td className="max-w-[250px] truncate px-3 py-2 text-text-muted">
                        {agent.currentStep ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
              <p className="text-xs text-text-muted">No agents currently running in this project</p>
            </div>
          )}
        </div>

        {/* All project agents (including completed/failed) */}
        {projectAgents.length > runningAgents.length && (
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              All Agents ({projectAgents.length})
            </h4>
            <div className="space-y-1">
              {projectAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-md border border-border bg-bg-secondary px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        agent.status === "running" && "bg-green-500",
                        agent.status === "completed" && "bg-green-500/50",
                        agent.status === "failed" && "bg-red-500",
                        agent.status === "idle" && "bg-zinc-500",
                        agent.status === "paused" && "bg-zinc-500",
                        agent.status === "waiting_input" && "bg-yellow-500",
                        agent.status === "spawning" && "bg-blue-500",
                      )}
                    />
                    <span className="text-xs font-medium text-text-primary">{agent.cliType}</span>
                    <span className="max-w-[300px] truncate text-xs text-text-muted">
                      {agent.taskDescription}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted">{agent.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
