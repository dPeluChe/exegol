import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { chatTime } from "../../../lib/session-chat";
import { trpcInvoke } from "../../../lib/trpc-client";

interface Entry {
  id: number;
  at: number;
  action: string;
  target: string | null;
  outcome: "done" | "refused";
  summary: string | null;
}

const LABELS: Record<string, string> = {
  agent_send: "Message to",
  message_cancel: "Cancelled a message",
  inbox_post: "Thread in",
  inbox_reply: "Reply in",
  inbox_take: "Took a thread in",
  inbox_close: "Closed a thread in",
  note_write: "Note in",
  note_retire: "Retired a note in",
  session_suspend: "Suspended",
  session_restart: "Restarted",
  project_add: "Added project",
};

/** What the Commander changed, newest first, across all its conversations */
export function CommanderHistory() {
  const { data } = useQuery({
    queryKey: ["commander", "history"],
    queryFn: () => trpcInvoke<Entry[]>("commander.history"),
  });
  if (!data) return null;
  if (data.length === 0) {
    return (
      <p className="mt-10 text-center text-[11px] text-text-muted">
        Nothing yet. What the Commander sends, writes, suspends, restarts or adds is kept here.
      </p>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-bg-secondary">
      {data.map((e) => (
        <li key={e.id} className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
          <span className="w-24 shrink-0 text-[10px] text-text-muted">{chatTime(e.at / 1000)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-text-primary">
              {LABELS[e.action] ?? e.action}
              {e.target && <span className="font-medium"> {e.target}</span>}
              {e.outcome === "refused" && <span className="ml-2 text-amber-400">Refused</span>}
            </div>
            {e.summary && (
              <p
                className={cn(
                  "mt-0.5 truncate text-[11px]",
                  e.outcome === "refused" ? "text-amber-400" : "text-text-muted",
                )}
                title={e.summary}
              >
                {e.summary}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
