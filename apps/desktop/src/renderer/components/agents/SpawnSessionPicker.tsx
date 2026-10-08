import type { ResumableSession } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { formatTimeAgo } from "../../lib/format";
import { trpcInvoke } from "../../lib/trpc-client";
import { SpawnChip } from "./SpawnOptions";
import type { SessionChoice } from "./use-spawn-form";

interface LocalSession {
  sessionId: string;
  title: string | null;
  name?: string | null;
  endedAt: number | null;
}

/** T161: start fresh, continue the CLI's own last session, or pick one */
export function SpawnSessionPicker({
  projectId,
  providerId,
  resumeFlag,
  useWorktree,
  session,
  onSession,
  localSessionId,
  onLocalSession,
}: {
  projectId: string;
  providerId: string;
  resumeFlag: string | undefined;
  useWorktree: boolean;
  session: SessionChoice;
  onSession: (choice: SessionChoice) => void;
  localSessionId: string | null;
  onLocalSession: (id: string | null) => void;
}) {
  const { data: resumable = [] } = useQuery({
    queryKey: ["resumableSessions", projectId],
    queryFn: () => trpcInvoke<ResumableSession[]>("agents.listResumable", { projectId, limit: 20 }),
    staleTime: 10_000,
  });
  // Only this provider's sessions: `claude --resume` cannot open a codex session.
  const resumableHere = resumable.filter((r) => r.cliType === providerId);

  const { data: localSessions = [] } = useQuery({
    queryKey: ["history", "resumableLocal", projectId],
    queryFn: () =>
      trpcInvoke<LocalSession[]>("history.resumableLocal", { projectId, provider: "claude-code" }),
    enabled: providerId === "claude-code",
    staleTime: 10_000,
  });

  // An isolated worktree is a new folder: there is nothing in it to continue
  const canContinue = !!resumeFlag && !useWorktree;
  const { data: hasSession } = useQuery({
    queryKey: ["history", "hasLocalSession", projectId, providerId],
    queryFn: () =>
      trpcInvoke<boolean | null>("history.hasLocalSession", { projectId, provider: providerId }),
    enabled: canContinue,
    staleTime: 10_000,
  });
  // false: the CLI has nothing here and would exit with an error. null: no way to check
  const showContinue = canContinue && hasSession !== false;

  if (resumableHere.length === 0 && !showContinue) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">Session</span>
      <div className="flex flex-wrap gap-1.5">
        <SpawnChip
          selected={(session === null || (session === "last" && !showContinue)) && !localSessionId}
          onClick={() => onSession(null)}
        >
          New
        </SpawnChip>
        {/* Works without a captured handle: it is the provider's own
            flag, which is what the user would type by hand. */}
        {showContinue && (
          <SpawnChip
            selected={session === "last"}
            onClick={() => onSession("last")}
            title={
              hasSession === null
                ? `Launches with ${resumeFlag}. Exegol cannot check for a previous session of this CLI here; if it finds none, a new one starts`
                : `Launches with ${resumeFlag}`
            }
            className="flex items-center gap-1.5"
          >
            <History className="h-3 w-3" />
            Continue last
            <code className="text-text-muted">{resumeFlag}</code>
          </SpawnChip>
        )}
        {resumableHere.slice(0, 5).map((past) => (
          <SpawnChip
            key={past.agentId}
            selected={session !== "last" && session?.agentId === past.agentId}
            onClick={() => onSession(past)}
            title={past.taskDescription}
            className="flex items-center gap-1.5"
          >
            <History className="h-3 w-3 shrink-0" />
            {/* The codename is how the user knew it; task text is the fallback. */}
            <span className="max-w-[150px] truncate">
              {past.alias ?? past.taskDescription.slice(0, 24)}
            </span>
            <span className="text-text-muted">{formatTimeAgo(past.endedAt)}</span>
          </SpawnChip>
        ))}
      </div>
      {providerId === "claude-code" && !useWorktree && localSessions.length > 0 && (
        <LocalSessionSelect
          sessions={localSessions}
          value={localSessionId}
          onChange={onLocalSession}
        />
      )}
    </div>
  );
}

function LocalSessionSelect({
  sessions,
  value,
  onChange,
}: {
  sessions: LocalSession[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "rounded-lg border bg-bg-secondary px-2 py-1.5 text-[11px] outline-none",
        value ? "border-accent/50 text-accent" : "border-border text-text-secondary",
      )}
      title="Resume a specific Claude session in this folder (claude --resume <id>)"
    >
      <option value="">Resume a session by name...</option>
      {sessions.map((l) => (
        <option key={l.sessionId} value={l.sessionId}>
          {(l.name ?? l.title ?? l.sessionId.slice(0, 8)).slice(0, 60)}
          {l.endedAt ? ` · ${formatTimeAgo(l.endedAt)}` : ""}
        </option>
      ))}
    </select>
  );
}
