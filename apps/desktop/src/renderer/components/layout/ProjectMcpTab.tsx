import type { ClaudeMcpServerInfo, Project } from "@exegol/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { mcpLoadSummary, toggleServer } from "../../lib/project-mcp";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";

const SCOPE_LABEL: Record<ClaudeMcpServerInfo["scope"], string> = {
  user: "All projects",
  local: "This folder",
  project: ".mcp.json",
};

/** Which of the person's MCP servers this project's Claude Code sessions load besides Exegol.
 *  A change is saved as it is made */
export function ProjectMcpTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [selected, setSelected] = useState(project.mcpServers ?? null);
  const { data: servers, isError } = useQuery({
    queryKey: ["projects", "mcpServers", project.id],
    queryFn: () => trpcInvoke<ClaudeMcpServerInfo[]>("projects.mcpServers", { id: project.id }),
  });
  const save = useMutation({
    mutationFn: (next: string[] | null) =>
      trpcMutate("projects.setMcpServers", { id: project.id, servers: next }),
    onMutate: (next) => {
      const before = selected;
      setSelected(next);
      return before;
    },
    onSuccess: onSaved,
    onError: (err, _next, before) => {
      setSelected(before ?? null);
      toastError("Could not save the project's MCP servers")(err);
    },
  });
  if (isError) {
    return (
      <p className="text-[11px] text-red-400">Could not read Claude Code's MCP configuration.</p>
    );
  }
  if (!servers) return <p className="text-[11px] text-text-muted">Reading…</p>;
  const limited = selected !== null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-text-muted">
        Exegol's own tools always load. These are your MCP servers from Claude Code's configuration:
        a local one (stdio) starts its own process in every session.
      </p>

      <div className="space-y-1.5 text-[11px] text-text-secondary">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="project-mcp-mode"
            checked={!limited}
            onChange={() => save.mutate(null)}
            className="mt-0.5"
          />
          <span>All of them, as Claude Code is configured</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="project-mcp-mode"
            checked={limited}
            onChange={() => save.mutate(servers.map((s) => s.name))}
            className="mt-0.5"
          />
          <span>Only the ones checked below</span>
        </label>
      </div>

      {servers.length === 0 ? (
        <p className="rounded border border-border bg-bg-tertiary px-2 py-2 text-[11px] text-text-muted">
          No MCP servers found in Claude Code's configuration for this project.
        </p>
      ) : (
        <div className="rounded border border-border bg-bg-tertiary">
          {servers.map((s) => (
            <label
              key={s.name}
              className="flex items-center gap-2 border-border border-b px-2 py-1.5 text-[11px] last:border-b-0"
            >
              <input
                type="checkbox"
                disabled={!limited}
                checked={!limited || selected.includes(s.name)}
                onChange={(e) =>
                  save.mutate(toggleServer(selected ?? [], s.name, e.target.checked))
                }
              />
              <span className="min-w-0 flex-1 truncate text-text-primary">{s.name}</span>
              <span className="shrink-0 text-text-muted">{SCOPE_LABEL[s.scope]}</span>
              <span className="w-24 shrink-0 text-right text-text-muted/70">
                {s.transport === "stdio" ? "process per session" : `remote (${s.transport})`}
              </span>
            </label>
          ))}
        </div>
      )}

      {servers.length > 0 && (
        <p className="text-[11px] text-text-secondary">{mcpLoadSummary(servers, selected)}</p>
      )}
      <p className="text-[10px] leading-relaxed text-text-muted">
        Saved as you change it. Applies to Claude Code sessions started or resumed from now on; open
        ones keep what they loaded. With a list, a server you add later stays off here until you
        check it, and servers from plugins or claude.ai connectors may not load. Other CLIs are not
        affected.
      </p>
    </div>
  );
}
