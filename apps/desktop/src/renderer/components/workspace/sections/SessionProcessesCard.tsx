import type { SessionProcesses } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  type SidecarSessionMemory,
  useSessionProcesses,
  useSidecarMemory,
} from "../../../hooks/use-trpc-resources";
import { sessionName } from "../../../lib/agent-label";
import { plural } from "../../../lib/plural";
import { GROUP_LABEL, mcpOf, processTotals } from "../../../lib/session-processes";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { formatBytes, thresholdColor } from "./resource-format";

type Scope = "project" | "all";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "project", label: "This project" },
  { id: "all", label: "All projects" },
];

const memory = (kb: number) => formatBytes(kb * 1024);

function Notice({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
      <p className="text-xs text-text-muted">{children}</p>
    </div>
  );
}

/** What every live session runs: its CLI, its MCP servers by name, and the rest */
export function SessionProcessesCard({ projectId }: { projectId: string }) {
  const { data, isError } = useSessionProcesses();
  const { data: sidecar } = useSidecarMemory();
  const [scope, setScope] = useState<Scope>("project");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = (data ?? []).filter((s) => scope === "all" || s.projectId === projectId);
  const totals = processTotals(list);
  const rings = new Map((sidecar?.sessions ?? []).map((s) => [s.id, s]));
  const summary = `${plural(totals.sessions, "session")} running ${totals.processes} ${totals.processes === 1 ? "process" : "processes"}, ${memory(totals.rssKb)}. MCP servers and Exegol's bridge: ${totals.mcpProcesses}, ${memory(totals.mcpRssKb)}.`;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Processes by session
        </h4>
        <SegmentedTabs tabs={SCOPES} active={scope} onChange={setScope} compact />
      </div>
      {isError ? (
        <Notice>Could not read the process table</Notice>
      ) : !data ? (
        <Notice>Reading processes…</Notice>
      ) : list.length === 0 ? (
        <Notice>No live sessions here</Notice>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-text-secondary">{summary}</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-bg-tertiary text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Session</th>
                  <th className="px-3 py-2 text-left font-medium">CLI</th>
                  <th className="px-3 py-2 text-right font-medium">CPU</th>
                  <th className="px-3 py-2 text-right font-medium">Processes</th>
                  <th className="px-3 py-2 text-right font-medium">MCP</th>
                  <th className="px-3 py-2 text-right font-medium">Memory</th>
                  <th className="px-3 py-2 text-right font-medium">Ring buffer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((s) => (
                  <SessionRow
                    key={s.agentId}
                    session={s}
                    ring={rings.get(s.agentId)}
                    showProject={scope === "all"}
                    open={openId === s.agentId}
                    onToggle={() => setOpenId(openId === s.agentId ? null : s.agentId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-text-muted">
            Resident memory as the system reports it: pages shared between processes count in each
            one, so the sum runs above what the sessions really hold. MCP servers are named from
            Claude Code's configuration; another CLI's show by program name.
          </p>
        </>
      )}
    </div>
  );
}

function SessionRow({
  session,
  ring,
  showProject,
  open,
  onToggle,
}: {
  session: SessionProcesses;
  ring: SidecarSessionMemory | undefined;
  showProject: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const mcp = mcpOf(session);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="bg-bg-secondary text-text-secondary">
        <td className="max-w-[260px] px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full min-w-0 items-center gap-1.5 text-left text-text-primary"
          >
            <Chevron className="h-3 w-3 shrink-0 text-text-muted" />
            <span className="truncate">{sessionName(session)}</span>
            {showProject && (
              <span className="shrink-0 text-text-muted">· {session.projectName}</span>
            )}
          </button>
        </td>
        <td className="px-3 py-2">{session.cliType}</td>
        <td className={cn("px-3 py-2 text-right tabular-nums", thresholdColor(session.cpu))}>
          {session.cpu.toFixed(1)}%
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{session.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{mcp.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{memory(session.rssKb)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-text-muted">
          {ring ? (ring.evicted ? "evicted (idle)" : formatBytes(ring.capacityBytes)) : "—"}
        </td>
      </tr>
      {open &&
        session.groups.map((g) => (
          <tr key={`${g.kind}:${g.name}`} className="bg-bg-tertiary/40 text-[11px] text-text-muted">
            <td className="py-1 pl-9 pr-3" colSpan={3}>
              <span className="text-text-secondary">{g.name}</span> · {GROUP_LABEL[g.kind]}
            </td>
            <td className="px-3 py-1 text-right tabular-nums">{g.count}</td>
            <td className="px-3 py-1" />
            <td className="px-3 py-1 text-right tabular-nums">{memory(g.rssKb)}</td>
            <td className="px-3 py-1" />
          </tr>
        ))}
    </>
  );
}
