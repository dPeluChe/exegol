import { cn } from "@exegol/ui";
import { useRecentSessions } from "../../hooks/use-trpc";
import { formatTimeAgoLong } from "../../lib/format";
import { STATUS_DOT_COLORS } from "../../lib/semantic-colors";
import { useAppStore } from "../../stores/app";

export function RecentSessions() {
  const { data: sessions, isLoading } = useRecentSessions(10);
  const setActiveProject = useAppStore((s) => s.setActiveProject);

  if (isLoading) {
    return (
      <div>
        <p className="text-[10px] italic text-text-muted">Loading...</p>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div>
        <p className="text-[10px] italic text-text-muted">No past sessions</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {sessions.map((session) => (
        <button
          type="button"
          key={session.id}
          onClick={() => setActiveProject(session.projectId)}
          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] text-text-muted hover:bg-white/5 hover:text-text-secondary"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              STATUS_DOT_COLORS[session.status] ?? "bg-zinc-500",
            )}
          />
          <span className="flex-1 truncate">{session.taskDescription}</span>
          <span className="shrink-0 text-[9px]">{formatTimeAgoLong(session.stoppedAt)}</span>
        </button>
      ))}
    </div>
  );
}
