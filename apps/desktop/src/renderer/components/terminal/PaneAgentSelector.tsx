import { cn } from "@exegol/ui";
import { Cpu, X } from "lucide-react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useTerminalStore } from "../../stores/terminals";

interface PaneAgentSelectorProps {
  paneId: string;
  rootAgentId: string;
}

export function PaneAgentSelector({ paneId, rootAgentId }: PaneAgentSelectorProps) {
  const { agents } = useProjectContext();
  const setPaneAgent = useTerminalStore((s) => s.setPaneAgent);
  const closePane = useTerminalStore((s) => s.closePane);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg-primary p-4">
      <Cpu className="h-8 w-8 text-text-muted" />
      <p className="text-sm text-text-muted">Select an agent for this pane</p>

      <div className="flex max-w-xs flex-col gap-1.5">
        {agents.map((agent) => (
          <button
            type="button"
            key={agent.id}
            onClick={() => setPaneAgent(rootAgentId, paneId, agent.id)}
            className={cn(
              "flex items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors",
              "bg-bg-secondary hover:bg-accent/20 text-text-primary",
            )}
          >
            <StatusDot status={agent.status} />
            <span className="truncate font-medium">{agent.cliType}</span>
            <span className="ml-auto truncate text-text-muted">
              {agent.taskDescription.slice(0, 40)}
              {agent.taskDescription.length > 40 ? "..." : ""}
            </span>
          </button>
        ))}

        {agents.length === 0 && (
          <p className="text-center text-xs text-text-muted">No agents available</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => closePane(rootAgentId, paneId)}
        className="mt-2 flex items-center gap-1 text-[11px] text-text-muted hover:text-red-400 transition-colors"
      >
        <X className="h-3 w-3" />
        Close pane
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-green-400"
      : status === "completed"
        ? "bg-blue-400"
        : status === "failed"
          ? "bg-red-400"
          : "bg-zinc-500";

  return <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />;
}
