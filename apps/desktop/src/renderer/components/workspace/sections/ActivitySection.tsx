import type { Activity } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AlertTriangle, CheckCircle, Clock, Globe, Play, Rss, Square, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useActivities } from "../../../hooks/use-trpc";
import { formatTimeAgoLong } from "../../../lib/format";
import { EmptyState, LoadingSpinner } from "../../common";

// ─── Constants ──────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = [
  { value: "", label: "All" },
  { value: "agent_spawned", label: "Spawned" },
  { value: "agent_completed", label: "Completed" },
  { value: "agent_failed", label: "Failed" },
  { value: "agent_stopped", label: "Stopped" },
  { value: "scheduler_fired", label: "Scheduled" },
  { value: "port_detected", label: "Port" },
] as const;

const TYPE_CONFIG: Record<string, { icon: typeof Play; color: string; bg: string }> = {
  agent_spawned: { icon: Play, color: "text-blue-400", bg: "bg-blue-500/10" },
  agent_completed: { icon: CheckCircle, color: "text-green-400", bg: "bg-green-500/10" },
  agent_failed: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
  agent_stopped: { icon: Square, color: "text-zinc-400", bg: "bg-zinc-500/10" },
  scheduler_fired: { icon: Clock, color: "text-purple-400", bg: "bg-purple-500/10" },
  port_detected: { icon: Globe, color: "text-cyan-400", bg: "bg-cyan-500/10" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Activity Row ───────────────────────────────────────────────────────────

function ActivityRow({ activity }: { activity: Activity }) {
  const config = TYPE_CONFIG[activity.type] ?? {
    icon: AlertTriangle,
    color: "text-text-muted",
    bg: "bg-bg-tertiary",
  };
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className={cn("mt-0.5 rounded-md p-1.5", config.bg)}>
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-primary">{activity.description}</p>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {formatTimeAgoLong(activity.createdAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function ActivitySection() {
  const { project } = useProjectContext();
  const [filter, setFilter] = useState("");
  const { data: activities, isLoading } = useActivities(project?.id ?? null, filter || undefined);

  // Group activities by day
  const grouped = useMemo(() => {
    if (!activities) return [];
    const groups: { date: string; items: Activity[] }[] = [];
    let currentDate = "";

    for (const a of activities) {
      const date = formatDate(a.createdAt);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, items: [] });
      }
      const lastGroup = groups[groups.length - 1];
      if (lastGroup) lastGroup.items.push(a);
    }
    return groups;
  }, [activities]);

  if (!project) {
    return (
      <EmptyState
        icon={<Rss className="h-8 w-8 text-text-muted" />}
        title="No project selected"
        description="Select a project to view activity"
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header + filters */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Activity</h3>
        <div className="flex gap-1">
          {ACTIVITY_TYPES.map((t) => (
            <button
              type="button"
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                filter === t.value
                  ? "bg-accent text-white"
                  : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <LoadingSpinner size="sm" label="Loading activity..." className="h-32" />
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<Rss className="h-8 w-8 text-text-muted" />}
            title="No activity yet"
            description="Agent events will appear here as they happen"
          />
        ) : (
          <div className="divide-y divide-border">
            {grouped.map((group) => (
              <div key={group.date}>
                {/* Day divider */}
                <div className="sticky top-0 z-10 bg-bg-primary px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {group.date}
                  </span>
                </div>
                {/* Activities for this day */}
                <div className="divide-y divide-border/50">
                  {group.items.map((a) => (
                    <ActivityRow key={a.id} activity={a} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
