import { type Activity, type ActivityType, AGENT_CLI_TYPES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  GitCommitHorizontal,
  Globe,
  Pause,
  Play,
  Square,
  XCircle,
} from "lucide-react";
import { useActivities, useProjects } from "../../hooks/use-trpc";
import { formatTimeAgo } from "../../lib/format";
import { useAppStore } from "../../stores/app";

const TYPE_CONFIG: Record<ActivityType, { icon: typeof Play; color: string }> = {
  agent_spawned: { icon: Play, color: "text-blue-400" },
  agent_completed: { icon: CheckCircle, color: "text-green-400" },
  agent_failed: { icon: XCircle, color: "text-red-400" },
  agent_stopped: { icon: Square, color: "text-zinc-400" },
  scheduler_fired: { icon: Clock, color: "text-purple-400" },
  port_detected: { icon: Globe, color: "text-cyan-400" },
  "budget:warning": { icon: AlertTriangle, color: "text-warning" },
  "resource:warning": { icon: AlertTriangle, color: "text-warning" },
  "security:warning": { icon: AlertTriangle, color: "text-error" },
  "run:failed": { icon: XCircle, color: "text-red-400" },
  "pipeline:paused": { icon: Pause, color: "text-warning" },
  "pipeline:completed": { icon: CheckCircle, color: "text-green-400" },
  "worktree:saved": { icon: GitCommitHorizontal, color: "text-text-muted" },
};

const CLI_PREFIX = new RegExp(`^(${AGENT_CLI_TYPES.join("|")})\\s+agent\\s+`, "i");

function ActivityItem({ activity, projectName }: { activity: Activity; projectName?: string }) {
  const config = TYPE_CONFIG[activity.type];
  const Icon = config.icon;

  // Clean up description: remove CLI prefix for readability
  const text = activity.description.replace(CLI_PREFIX, "");
  const desc = projectName ? `${projectName}: ${text}` : text;

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-white/5">
      <div
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          config.color,
        )}
      >
        <Icon className="h-3 w-3" />
      </div>
      <p className="flex-1 truncate text-[10px] text-text-secondary" title={desc}>
        {desc}
      </p>
      <span className="shrink-0 text-[9px] tabular-nums text-text-muted">
        {formatTimeAgo(activity.createdAt)}
      </span>
    </div>
  );
}

export function ActivityFeed() {
  const projectId = useAppStore((s) => s.activeProjectId);
  // Show activities for active project, or all if none selected
  const { data: activities } = useActivities(projectId);
  const { data: projects } = useProjects();

  if (!activities || activities.length === 0) {
    return (
      <p className="py-2 text-center text-[10px] italic text-text-muted">No recent activity</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {activities.slice(0, 6).map((a) => (
        <ActivityItem
          key={a.id}
          activity={a}
          projectName={projectId ? undefined : projects?.find((p) => p.id === a.projectId)?.name}
        />
      ))}
    </div>
  );
}
