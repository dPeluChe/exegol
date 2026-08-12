import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Circle, ExternalLink, Network } from "lucide-react";
import { useState } from "react";
import { trpcInvoke } from "../../lib/trpc-client";
import { FilterChip } from "../common/FilterChip";

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

type McpTab = "server" | "tools" | "providers";

/** T162/T163: visibility into Exegol's own MCP server — what it serves, to
 *  whom, and where each provider's wiring lands. */
export function McpServerSettings() {
  const [tab, setTab] = useState<McpTab>("server");
  const { data } = useQuery({
    queryKey: ["mcp", "exegolStatus"],
    queryFn: () => trpcInvoke<ExegolMcpStatus>("mcp.exegolStatus"),
    refetchInterval: 15_000,
  });

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
        <div className="ml-auto flex items-center gap-1">
          <FilterChip active={tab === "server"} onClick={() => setTab("server")}>
            Server
          </FilterChip>
          <FilterChip active={tab === "tools"} onClick={() => setTab("tools")}>
            Tools ({data?.tools.length ?? 0})
          </FilterChip>
          <FilterChip active={tab === "providers"} onClick={() => setTab("providers")}>
            Providers
          </FilterChip>
        </div>
      </div>

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
          <DocsLink
            href={data?.specUrl ?? "https://modelcontextprotocol.io"}
            label="What is MCP? — official protocol documentation"
          />
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
