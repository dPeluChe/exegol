import type { McpSessionInfo } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Circle, ExternalLink, Network } from "lucide-react";
import { useState } from "react";
import { useSettings, useUpdateSettings } from "../../hooks/use-trpc";
import { openInBrowser } from "../../lib/open-in-browser";
import { trpcInvoke } from "../../lib/trpc-client";
import { SegmentedTabs } from "../common/SegmentedTabs";
import { type McpActivityEntry, McpActivityTab } from "./McpActivityTab";

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
  connected: number;
  tools: Array<{ name: string; description: string }>;
  providers: ProviderWiring[];
  specUrl: string;
}

const STATUS_TONE: Record<string, string> = {
  wired: "bg-green-500/15 text-green-300",
  "receive-only": "bg-amber-500/15 text-amber-300",
  "best-effort": "bg-blue-500/15 text-blue-300",
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
  const { data: sessions } = useQuery({
    queryKey: ["mcp", "exegolSessions"],
    queryFn: () => trpcInvoke<McpSessionInfo[]>("mcp.exegolSessions"),
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
        {data && <RunningBadge running={data.running} />}
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
        <ServerTab
          data={data}
          verbose={settings?.mcpVerboseLogging === true}
          onVerboseChange={(mcpVerboseLogging) => updateSettings.mutate({ mcpVerboseLogging })}
        />
      )}
      {tab === "activity" && <McpActivityTab activity={activity ?? []} sessions={sessions ?? []} />}
      {tab === "tools" && <ToolsTab tools={data?.tools ?? []} />}
      {tab === "providers" && (
        <ProvidersTab
          providers={data?.providers ?? []}
          specUrl={data?.specUrl ?? "https://modelcontextprotocol.io"}
        />
      )}
    </div>
  );
}

function RunningBadge({ running }: { running: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        running ? "bg-green-500/15 text-green-300" : "bg-zinc-500/15 text-text-muted"
      }`}
    >
      {running ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {running ? "Listening" : "Stopped (starts with the first agent)"}
    </span>
  );
}

function ServerTab({
  data,
  verbose,
  onVerboseChange,
}: {
  data: ExegolMcpStatus | undefined;
  verbose: boolean;
  onVerboseChange: (verbose: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <p className="text-xs leading-relaxed text-text-muted">
          The bridge every agent uses for the inbox, notes, the browser and inter-agent messaging.
          Identity comes from a per-agent token minted at spawn — never from what the agent claims,
          so a message's sender can always be trusted.
        </p>
        {data && (
          <div className="mt-3 space-y-1.5 text-[11px] text-text-muted">
            <div>
              Socket: <code className="text-text-secondary">{data.sockPath}</code>
            </div>
            <div>
              Active agent tokens: <span className="text-text-primary">{data.activeTokens}</span>{" "}
              <span className="text-text-muted/70">
                (one per live non-shell agent; revoked on exit)
              </span>
            </div>
            <div>
              Bridges connected: <span className="text-text-primary">{data.connected}</span>{" "}
              <span className="text-text-muted/70">(by session in the Activity tab)</span>
            </div>
          </div>
        )}
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-bg-secondary p-4">
        <input
          type="checkbox"
          checked={verbose}
          onChange={(e) => onVerboseChange(e.target.checked)}
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
  );
}

function ToolsTab({ tools }: { tools: ExegolMcpStatus["tools"] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-text-muted">
        Served to every agent Exegol spawns. Read/plan-mode agents see all of these except the
        browser tools that act on a page.
      </p>
      {tools.map((tool) => (
        <div key={tool.name} className="rounded-md border border-border bg-bg-tertiary px-3 py-2">
          <code className="text-xs font-medium text-accent">{tool.name}</code>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{tool.description}</p>
        </div>
      ))}
    </div>
  );
}

function ProvidersTab({ providers, specUrl }: { providers: ProviderWiring[]; specUrl: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-text-muted">
        Written automatically when an agent spawns (the token is revoked on exit). This is where
        each CLI discovers the exegol server — use the check command to verify from inside a
        session.
      </p>
      {providers.map((p) => (
        <ProviderWiringRow key={p.cliType} wiring={p} />
      ))}
      <DocsLink href={specUrl} label="MCP protocol docs — client config conventions" />
    </div>
  );
}

function ProviderWiringRow({ wiring: p }: { wiring: ProviderWiring }) {
  return (
    <div className="rounded-md border border-border bg-bg-tertiary px-3 py-2">
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
            onClick={() => p.docsUrl && openInBrowser(p.docsUrl)}
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
  );
}

function DocsLink({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => openInBrowser(href)}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
    >
      <BookOpen className="h-3 w-3 shrink-0 text-accent" />
      <span className="flex-1 text-left">{label}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-text-muted" />
    </button>
  );
}
