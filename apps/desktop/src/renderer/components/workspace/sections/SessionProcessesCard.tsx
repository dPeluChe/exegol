import type { SessionProcesses } from "@exegol/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useSessionProcesses } from "../../../hooks/use-trpc-resources";
import { sessionName } from "../../../lib/agent-label";
import { GROUP_LABEL, mcpOf, processTotals } from "../../../lib/session-processes";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { formatBytes } from "./resource-format";

type Scope = "project" | "all";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "project", label: "This project" },
  { id: "all", label: "All projects" },
];

const memory = (kb: number) => formatBytes(kb * 1024);

/** What every live session runs: its CLI, its MCP servers by name, and the rest */
export function SessionProcessesCard({ projectId }: { projectId: string }) {
  const { data } = useSessionProcesses();
  const [scope, setScope] = useState<Scope>("project");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = (data ?? []).filter((s) => scope === "all" || s.projectId === projectId);
  const totals = processTotals(list);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Processes by session
        </h4>
        <SegmentedTabs tabs={SCOPES} active={scope} onChange={setScope} compact />
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
          <p className="text-xs text-text-muted">
            {data ? "No live sessions here" : "Reading processes…"}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-text-secondary">
            {totals.sessions} sessions run {totals.processes} processes using {memory(totals.rssKb)}
            . MCP servers: {totals.mcpProcesses} processes, {memory(totals.mcpRssKb)}.
          </p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-bg-tertiary text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Session</th>
                  <th className="px-3 py-2 text-left font-medium">CLI</th>
                  <th className="px-3 py-2 text-right font-medium">Processes</th>
                  <th className="px-3 py-2 text-right font-medium">MCP</th>
                  <th className="px-3 py-2 text-right font-medium">Memory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((s) => (
                  <SessionRow
                    key={s.agentId}
                    session={s}
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
            one, so the sum runs above what the sessions really hold.
          </p>
        </>
      )}
    </div>
  );
}

function SessionRow({
  session,
  showProject,
  open,
  onToggle,
}: {
  session: SessionProcesses;
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
        <td className="px-3 py-2 text-right tabular-nums">{session.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{mcp.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{memory(session.rssKb)}</td>
      </tr>
      {open &&
        session.groups.map((g) => (
          <tr key={`${g.kind}:${g.name}`} className="bg-bg-tertiary/40 text-[11px] text-text-muted">
            <td className="py-1 pl-9 pr-3 text-text-secondary">{g.name}</td>
            <td className="px-3 py-1">{GROUP_LABEL[g.kind]}</td>
            <td className="px-3 py-1 text-right tabular-nums">{g.count}</td>
            <td className="px-3 py-1" />
            <td className="px-3 py-1 text-right tabular-nums">{memory(g.rssKb)}</td>
          </tr>
        ))}
    </>
  );
}
