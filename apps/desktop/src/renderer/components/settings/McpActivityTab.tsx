import type { McpAgentState, McpSessionInfo } from "@exegol/shared";
import { useMemo } from "react";
import { sessionName } from "../../lib/agent-label";

export interface McpActivityEntry {
  at: number;
  kind: "connect" | "disconnect" | "call" | "error";
  tool?: string;
  agentId?: string;
  ms?: number;
  detail?: string;
}

const ACTIVITY_TONE: Record<McpActivityEntry["kind"], string> = {
  connect: "text-green-300",
  disconnect: "text-text-muted",
  call: "text-accent",
  error: "text-red-300",
};

const STATE_LABEL: Record<McpAgentState, string> = {
  connected: "Connected",
  not_connected: "Not connected",
  not_wired: "Not wired",
};

const STATE_TONE: Record<McpAgentState, string> = {
  connected: "bg-green-500/15 text-green-300",
  not_connected: "bg-amber-500/15 text-amber-300",
  not_wired: "bg-zinc-500/15 text-text-muted",
};

const STATE_ORDER: McpAgentState[] = ["not_connected", "connected", "not_wired"];

/** Pure: "38 connected, 9 not connected, 2 not wired", states with none left out */
export function sessionsSummary(sessions: McpSessionInfo[]): string {
  return STATE_ORDER.map((state) => ({
    state,
    count: sessions.filter((s) => s.state === state).length,
  }))
    .filter((g) => g.count > 0)
    .map((g) => `${g.count} ${STATE_LABEL[g.state].toLowerCase()}`)
    .join(", ");
}

export function McpActivityTab({
  activity,
  sessions,
}: {
  activity: McpActivityEntry[];
  sessions: McpSessionInfo[];
}) {
  const names = useMemo(() => new Map(sessions.map((s) => [s.id, sessionName(s)])), [sessions]);
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)),
    [sessions],
  );
  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h4 className="text-xs font-medium text-text-primary">
          Sessions{" "}
          <span className="font-normal text-text-muted">
            {sessions.length === 0 ? "none live" : sessionsSummary(sessions)}
          </span>
        </h4>
        <p className="text-xs text-text-muted">
          Each agent session starts its own bridge to this server. Not connected means its CLI has
          not started the bridge, or the session began before this version and has not called a tool
          since the app restarted.
        </p>
        {ordered.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-bg-tertiary">
            {ordered.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-[11px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-text-primary">{sessionName(s)}</span>
                <span className="shrink-0 text-text-muted">{s.projectName ?? "No project"}</span>
                <span className="shrink-0 text-text-muted/70">{s.cliType}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATE_TONE[s.state]}`}
                >
                  {STATE_LABEL[s.state]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-medium text-text-primary">Events</h4>
        <p className="text-xs text-text-muted">
          Last 100 socket events since the app started, newest first, live while this tab is open.
        </p>
        {activity.length === 0 && (
          <p className="rounded-md border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-muted">
            Nothing since the app started. An event appears when a bridge connects or an agent calls
            a tool (inbox_post, note_write, agents_list, agent_send…).
          </p>
        )}
        {activity.map((entry, i) => (
          <ActivityRow
            // biome-ignore lint/suspicious/noArrayIndexKey: stateless rows of a list replaced whole
            key={i}
            entry={entry}
            name={entry.agentId ? (names.get(entry.agentId) ?? entry.agentId.slice(0, 8)) : null}
          />
        ))}
      </section>
    </div>
  );
}

function ActivityRow({ entry, name }: { entry: McpActivityEntry; name: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 font-mono text-[10px]">
      <span className="shrink-0 text-text-muted">{new Date(entry.at).toLocaleTimeString()}</span>
      <span className={`shrink-0 font-medium ${ACTIVITY_TONE[entry.kind]}`}>{entry.kind}</span>
      {entry.tool && <span className="shrink-0 text-text-secondary">{entry.tool}</span>}
      {name && <span className="shrink-0 text-text-muted/70">{name}</span>}
      {entry.ms !== undefined && <span className="shrink-0 text-text-muted/70">{entry.ms}ms</span>}
      {entry.detail && (
        <span className="min-w-0 flex-1 break-words text-text-muted">{entry.detail}</span>
      )}
    </div>
  );
}
