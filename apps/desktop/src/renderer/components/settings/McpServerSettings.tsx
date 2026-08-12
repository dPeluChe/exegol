import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Network } from "lucide-react";
import { trpcInvoke } from "../../lib/trpc-client";

interface ExegolMcpStatus {
  running: boolean;
  sockPath: string;
  activeTokens: number;
  tools: Array<{ name: string; description: string }>;
  providers: Array<{
    provider: string;
    cliType: string;
    config: string;
    tokenVia: string;
    status: string;
  }>;
}

const STATUS_TONE: Record<string, string> = {
  wired: "bg-green-500/15 text-green-300",
  "receive-only": "bg-amber-500/15 text-amber-300",
  "best-effort": "bg-blue-500/15 text-blue-300",
};

/** T162/T163: visibility into Exegol's own MCP server — what it serves, to
 *  whom, and where each provider's wiring lands (Antonio: "para que realmente
 *  puedan ver instrucciones"). */
export function McpServerSettings() {
  const { data } = useQuery({
    queryKey: ["mcp", "exegolStatus"],
    queryFn: () => trpcInvoke<ExegolMcpStatus>("mcp.exegolStatus"),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      {/* Server status */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Exegol MCP Server</h3>
          {data && (
            <span
              className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                data.running ? "bg-green-500/15 text-green-300" : "bg-zinc-500/15 text-text-muted"
              }`}
            >
              {data.running ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
              {data.running ? "Listening" : "Stopped (starts with the first agent)"}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          The bridge every agent uses for shared memory, knowledge and inter-agent messaging.
          Identity comes from a per-agent token minted at spawn — never from what the agent claims.
        </p>
        {data && (
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-text-muted">
            <span>
              Socket: <code className="text-text-secondary">{data.sockPath}</code>
            </span>
            <span>
              Active agent tokens: <span className="text-text-primary">{data.activeTokens}</span>
            </span>
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">Tools served to agents</h3>
        <div className="mt-2 space-y-1.5">
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
      </div>

      {/* Per-provider wiring */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">Per-provider wiring</h3>
        <p className="mt-1 text-xs text-text-muted">
          Written automatically when an agent spawns (the token is revoked on exit). This is where
          each CLI discovers the exegol server.
        </p>
        <div className="mt-2 space-y-1.5">
          {(data?.providers ?? []).map((p) => (
            <div
              key={p.cliType}
              className="flex items-start gap-2.5 rounded-md border border-border bg-bg-tertiary px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{p.provider}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase ${
                      STATUS_TONE[p.status] ?? "bg-zinc-500/15 text-text-muted"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Config: <code className="text-text-secondary">{p.config}</code>
                  <span className="mx-1.5">·</span>
                  Token via {p.tokenVia}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
