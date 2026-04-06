import type { Activity } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { CheckCircle, Clock, Globe, Play, Square, XCircle } from "lucide-react";
import { useActivities } from "../../hooks/use-trpc";
import { formatTimeAgo } from "../../lib/format";
import { useAppStore } from "../../stores/app";

const TYPE_CONFIG: Record<string, { icon: typeof Play; color: string }> = {
  agent_spawned: { icon: Play, color: "text-blue-400" },
  agent_completed: { icon: CheckCircle, color: "text-green-400" },
  agent_failed: { icon: XCircle, color: "text-red-400" },
  agent_stopped: { icon: Square, color: "text-zinc-400" },
  scheduler_fired: { icon: Clock, color: "text-purple-400" },
  port_detected: { icon: Globe, color: "text-cyan-400" },
};

function ActivityItem({ activity, showProject }: { activity: Activity; showProject?: boolean }) {
  const config = TYPE_CONFIG[activity.type] ?? { icon: Play, color: "text-text-muted" };
  const Icon = config.icon;

  // Clean up description: remove CLI prefix for readability
  let desc = activity.description
    .replace(
      /^(claude-code|codex|gemini|aider|goose|opencode|amp|kiro|kilocode|crush|shell|factory-droid)\s+agent\s+/i,
      "",
    )
    .slice(0, 55);
  if (showProject && activity.projectId) {
    desc = `[${activity.projectId.slice(0, 6)}] ${desc}`;
  }

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
      <p className="flex-1 truncate text-[10px] text-text-secondary">{desc}</p>
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

  if (!activities || activities.length === 0) {
    return (
      <p className="py-2 text-center text-[10px] italic text-text-muted">No recent activity</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {activities.slice(0, 6).map((a) => (
        <ActivityItem key={a.id} activity={a} showProject={!projectId} />
      ))}
    </div>
  );
}
