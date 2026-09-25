import type { DevServer } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, ExternalLink, Network, RefreshCw, Square } from "lucide-react";
import { useState } from "react";
import { useDevServers, useKillDevServer } from "../../../hooks/use-trpc-resources";
import { jumpToAgent } from "../../../stores/agents";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { formatUptime } from "./resource-format";

/**
 * Every port your processes listen on. Project servers first, with the Exegol
 * terminal that started them; a server with no terminal is one left behind by
 * a closed pane or another session, and can be stopped from here.
 */
export function DevServersCard() {
  const { data: servers = [], isFetching, refetch } = useDevServers();
  const [showOthers, setShowOthers] = useState(false);
  const [confirm, setConfirm] = useState<DevServer | null>(null);
  const kill = useKillDevServer();

  const mine = servers.filter((s) => s.project || s.agent);
  const others = servers.filter((s) => !s.project && !s.agent);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-2 text-text-muted">
        <Network className="h-4 w-4" />
        <span className="text-xs font-medium">Dev servers & ports</span>
        <span className="text-[10px]">({mine.length} in projects)</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto rounded p-1 hover:bg-white/10 hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </button>
      </div>

      {mine.length === 0 ? (
        <p className="mt-2 text-[11px] text-text-muted">
          No server is running from a project folder.
        </p>
      ) : (
        <div className="mt-2 space-y-px">
          {mine.map((s) => (
            <ServerRow key={s.pid} server={s} onStop={() => setConfirm(s)} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary"
          >
            {showOthers ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Other listeners ({others.length})
          </button>
          {showOthers && (
            <div className="mt-1 space-y-px">
              {others.map((s) => (
                <ServerRow key={s.pid} server={s} onStop={() => setConfirm(s)} />
              ))}
            </div>
          )}
        </div>
      )}

      {kill.isError && (
        <p className="mt-2 text-[11px] text-red-400">Could not stop it: {String(kill.error)}</p>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Stop ${confirm?.process ?? ""} (pid ${confirm?.pid ?? ""})?`}
        description={`It listens on ${confirm?.ports.map((p) => `:${p}`).join(", ") ?? ""}. Exegol sends SIGTERM, then SIGKILL if it is still running after 3 seconds.`}
        confirmLabel="Stop"
        variant="destructive"
        onConfirm={() => confirm && kill.mutate(confirm.pid)}
      />
    </div>
  );
}

function ServerRow({ server: s, onStop }: { server: DevServer; onStop: () => void }) {
  const where = s.project?.name ?? s.cwd?.split("/").slice(-2).join("/") ?? "";
  return (
    <div className="group flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-white/5">
      <div className="flex w-28 shrink-0 flex-wrap gap-1">
        {s.ports.map((port) => (
          <button
            key={port}
            type="button"
            onClick={() => window.open(`http://localhost:${port}`, "_blank")}
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 font-mono text-[10px] hover:bg-white/10",
              s.conflict ? "text-amber-400" : "text-green-400",
            )}
            title={
              s.conflict ? "Another process listens on this port too" : `Open localhost:${port}`
            }
          >
            :{port}
            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
          </button>
        ))}
      </div>
      <span className="w-24 shrink-0 truncate text-text-primary" title={s.command}>
        {s.process}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-muted" title={s.cwd ?? undefined}>
        {where}
      </span>
      {s.agent ? (
        <button
          type="button"
          onClick={() => s.agent && jumpToAgent(s.agent.id, s.agent.projectId)}
          className="shrink-0 rounded px-1 text-[10px] text-accent hover:bg-accent/10"
          title="Go to the terminal that started it"
        >
          {s.agent.alias ?? (s.agent.cliType === "shell" ? "terminal" : s.agent.cliType)}
        </button>
      ) : (
        <span
          className="shrink-0 text-[10px] text-text-muted/60"
          title="Not started from an open Exegol terminal"
        >
          no terminal
        </span>
      )}
      <span className="w-12 shrink-0 text-right tabular-nums text-[10px] text-text-muted">
        {s.uptimeSeconds !== null ? formatUptime(s.uptimeSeconds) : ""}
      </span>
      <button
        type="button"
        onClick={onStop}
        className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-red-400/20 hover:text-red-400 group-hover:opacity-100"
        title="Stop this process"
      >
        <Square className="h-3 w-3" />
      </button>
    </div>
  );
}
