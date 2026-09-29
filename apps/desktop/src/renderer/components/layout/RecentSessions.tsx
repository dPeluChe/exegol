import { cn } from "@exegol/ui";
import { useRecentSessions } from "../../hooks/use-trpc";
import { formatTimeAgoLong } from "../../lib/format";
import { STATUS_DOT_COLORS } from "../../lib/semantic-colors";
import { useAppStore } from "../../stores/app";
import { AgentIcon } from "../common/AgentIcon";

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
      {sessions.map((session) => {
        const task = taskLine(session.taskDescription);
        return (
          <button
            type="button"
            key={session.id}
            onClick={() => setActiveProject(session.projectId)}
            className="flex w-full flex-col rounded px-1 py-0.5 text-left text-[10px] text-text-muted hover:bg-white/5 hover:text-text-secondary"
            title={`${session.projectName}: ${session.taskDescription}`}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  STATUS_DOT_COLORS[session.status] ?? "bg-zinc-500",
                )}
              />
              <AgentIcon provider={session.cliType} size={11} />
              <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">
                {session.projectName}
              </span>
              {session.stoppedAt && (
                <span className="shrink-0 text-[9px]">{formatTimeAgoLong(session.stoppedAt)}</span>
              )}
            </span>
            {task && <span className="w-full truncate pl-[26px] text-[9px]">{task}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The task without handoff boilerplate or markdown; nothing when it only repeats the CLI name */
function taskLine(text: string): string | null {
  const clean = text
    .replace(/\[HANDOFF[^\]]*\]/gi, "")
    .replace(/#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cliNames = /^(claude code|codex|devin|terminal|shell|antigravity|opencode|gemini)$/i;
  return clean && !cliNames.test(clean) ? clean : null;
}
