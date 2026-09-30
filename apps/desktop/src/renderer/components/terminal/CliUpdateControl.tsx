import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { restartNeeded, useCliUpdates } from "../../hooks/use-cli-updates";
import { runCommandInNewTab } from "../../lib/spawn-shell";
import { useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";

const chip = "flex shrink-0 items-center gap-1 text-[9px]";

/** Restart onto a CLI version installed since the session started (after this turn if it is
 *  working), or Update when a newer release is out: the command runs in a new tab you can see */
export function CliUpdateControl({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const pending = useCliRestartStore((s) => !!s.pending[agentId]);
  const status = useCliUpdates().get(agent?.cliType ?? "");
  if (!agent || !status) return null;

  if (pending) {
    return (
      <>
        <button
          type="button"
          onClick={() => useCliRestartStore.getState().cancel(agentId)}
          className={`${chip} text-accent hover:text-text-primary`}
          title="Restarts on the new version when this turn ends. Click to cancel"
        >
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          Restarts after this turn
        </button>
        <button
          type="button"
          onClick={() => useCliRestartStore.getState().request(agentId, true)}
          className={`${chip} text-text-muted hover:text-text-primary`}
          title="Restart now, cutting the current turn (the conversation still resumes)"
        >
          Now
        </button>
      </>
    );
  }

  if (restartNeeded(agent, status)) {
    return (
      <button
        type="button"
        onClick={() => useCliRestartStore.getState().request(agentId)}
        className={`${chip} text-accent hover:text-text-primary`}
        title={`${status.installed} is installed; this session runs ${agent.cliVersion}. Restart it on the new version: the conversation resumes (after the current turn if it is working)`}
      >
        <RefreshCw className="h-2.5 w-2.5" />
        Restart to update
      </button>
    );
  }

  const cmd = status.updateCommand;
  if (status.updateAvailable && cmd) {
    return (
      <button
        type="button"
        onClick={() =>
          runCommandInNewTab(agent.projectId, cmd).catch((err) =>
            console.error("[CliUpdate] Update failed to start:", err),
          )
        }
        className={`${chip} text-text-muted hover:text-text-primary`}
        title={`${status.latest} is out (installed: ${status.installed}). Runs \`${cmd}\` in a new tab; then this session offers Restart to update`}
      >
        <ArrowUpCircle className="h-2.5 w-2.5" />
        Update {status.latest}
      </button>
    );
  }
  return null;
}
