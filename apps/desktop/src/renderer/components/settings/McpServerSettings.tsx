import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen, CheckCircle2, Circle, ExternalLink, Network } from "lucide-react";
import { useState } from "react";
import { useSettings, useUpdateSettings } from "../../hooks/use-trpc";
import { trpcInvoke } from "../../lib/trpc-client";
import { SegmentedTabs } from "../common/SegmentedTabs";

interface ProviderWiring {
  provider: string;
  cliType: string;
  config: string;
  tokenVia: string;
  status: string;
  inspectCmd: string | null;
  docsUrl: string | null;
}

interface ExegolMcpStatus {
  running: boolean;
  sockPath: string;
  activeTokens: number;
  tools: Array<{ name: string; description: string }>;
  providers: ProviderWiring[];
  specUrl: string;
}

const STATUS_TONE: Record<string, string> = {
  wired: "bg-green-500/15 text-green-300",
  "receive-only": "bg-amber-500/15 text-amber-300",
  "best-effort": "bg-blue-500/15 text-blue-300",
};

interface McpActivityEntry {
  at: number;
  kind: "connect" | "disconnect" | "call" | "error";
  tool?: string;
  agentId?: string;
  ms?: number;
  detail?: string;
}

const ACTIVITY_TONE: Record<string, string> = {
  connect: "text-green-300",
  disconnect: "text-text-muted",
  call: "text-accent",
  error: "text-red-300",
};

type McpTab = "server" | "activity" | "tools" | "providers";

/** T162/T163: visibility into Exegol's own MCP server — what it serves, to
 *  whom, and where each provider's wiring lands. */
export function McpServerSettings() {
  const [tab, setTab] = useState<McpTab>("server");
  const { data } = useQuery({
    queryKey: ["mcp", "exegolStatus"],
    queryFn: () => trpcInvoke<ExegolMcpStatus>("mcp.exegolStatus"),
    refetchInterval: 15_000,
  });
  const { data: activity } = useQuery({
    queryKey: ["mcp", "exegolActivity"],
    queryFn: () => trpcInvoke<McpActivityEntry[]>("mcp.exegolActivity"),
    refetchInterval: tab === "activity" ? 2_000 : false,
    enabled: tab === "activity",
  });
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Exegol MCP Server</h3>
        {data && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              data.running ? "bg-green-500/15 text-green-300" : "bg-zinc-500/15 text-text-muted"
            }`}
          >
            {data.running ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
            {data.running ? "Listening" : "Stopped (starts with the first agent)"}
          </span>
        )}
      </div>

      <SegmentedTabs
        tabs={[
          { id: "server", label: "Server" },
          { id: "activity", label: "Activity" },
          { id: "tools", label: "Tools", count: data?.tools.length },
          { id: "providers", label: "Providers", count: data?.providers.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "server" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <p className="text-xs leading-relaxed text-text-muted">
              The bridge every agent uses for shared memory, knowledge and inter-agent messaging.
              Identity comes from a per-agent token minted at spawn — never from what the agent
              claims, so a message's sender can always be trusted.
            </p>
            {data && (
              <div className="mt-3 space-y-1.5 text-[11px] text-text-muted">
                <div>
                  Socket: <code className="text-text-secondary">{data.sockPath}</code>
                </div>
                <div>
                  Active agent tokens:{" "}
                  <span className="text-text-primary">{data.activeTokens}</span>{" "}
                  <span className="text-text-muted/70">
                    (one per live non-shell agent; revoked on exit)
                  </span>
                </div>
              </div>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-bg-secondary p-4">
            <input
              type="checkbox"
              checked={settings?.mcpVerboseLogging === true}
              onChange={(e) => updateSettings.mutate({ mcpVerboseLogging: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-text-primary">
                Verbose logging to the app log
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-text-muted">
                Writes every socket connection and tool call to the backend log. Off by default so a
                busy fleet doesn't drown it — the Activity tab works either way.
              </span>
            </span>
          </label>
          <DocsLink
            href={data?.specUrl ?? "https://modelcontextprotocol.io"}
            label="What is MCP? — official protocol documentation"
          />
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-1.5">
          <p className="text-xs text-text-muted">
            Last 100 socket events (newest first, live while this tab is open). A shim that stops
            reconnecting after an app restart shows up here as silence — no new `connect`.
          </p>
          {(activity ?? []).length === 0 && (
            <p className="rounded-md border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-muted">
              No activity yet. Agents talk to the server when they call a tool (memory, knowledge,
              agents_list, agent_send…).
            </p>
          )}
          {(activity ?? []).map((entry) => (
            <div
              key={`${entry.at}-${entry.kind}-${entry.tool ?? ""}-${entry.agentId ?? ""}`}
              className="flex items-start gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 font-mono text-[10px]"
            >
              <span className="shrink-0 text-text-muted">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 font-medium ${ACTIVITY_TONE[entry.kind] ?? ""}`}>
                {entry.kind}
              </span>
              {entry.tool && <span className="shrink-0 text-text-secondary">{entry.tool}</span>}
              {entry.agentId && (
                <span className="shrink-0 text-text-muted/70">{entry.agentId.slice(0, 8)}</span>
              )}
              {entry.ms !== undefined && (
                <span className="shrink-0 text-text-muted/70">{entry.ms}ms</span>
              )}
              {entry.detail && (
                <span className="min-w-0 flex-1 break-words text-text-muted">{entry.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "tools" && (
        <div className="space-y-1.5">
          <p className="text-xs text-text-muted">
            Served to every agent Exegol spawns. Read/plan-mode agents see all of these except
            memory_save.
          </p>
          {(data?.tools ?? []).map((tool) => (
            <div
              key={tool.name}
              className="rounded-md border border-border bg-bg-tertiary px-3 py-2"
            >
              <code className="text-xs font-medium text-accent">{tool.name}</code>
              <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === "providers" && (
        <div className="space-y-1.5">
          <p className="text-xs text-text-muted">
            Written automatically when an agent spawns (the token is revoked on exit). This is where
            each CLI discovers the exegol server — use the check command to verify from inside a
            session.
          </p>
          {(data?.providers ?? []).map((p) => (
            <div
              key={p.cliType}
              className="rounded-md border border-border bg-bg-tertiary px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">{p.provider}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase ${
                    STATUS_TONE[p.status] ?? "bg-zinc-500/15 text-text-muted"
                  }`}
                >
                  {p.status}
                </span>
                {p.docsUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(p.docsUrl ?? undefined, "_blank")}
                    className="ml-auto flex items-center gap-1 text-[10px] text-accent hover:underline"
                  >
                    <BookOpen className="h-2.5 w-2.5" />
                    MCP docs
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                Config: <code className="text-text-secondary">{p.config}</code>
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">Token via {p.tokenVia}</p>
              {p.inspectCmd && (
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Check with: <code className="text-text-secondary">{p.inspectCmd}</code>
                </p>
              )}
            </div>
          ))}
          <DocsLink
            href={data?.specUrl ?? "https://modelcontextprotocol.io"}
            label="MCP protocol docs — client config conventions"
          />
        </div>
      )}
    </div>
  );
}

function DocsLink({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(href, "_blank")}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
    >
      <BookOpen className="h-3 w-3 shrink-0 text-accent" />
      <span className="flex-1 text-left">{label}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-text-muted" />
    </button>
  );
}
