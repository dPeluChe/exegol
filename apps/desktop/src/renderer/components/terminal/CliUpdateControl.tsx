import { LIVE_STATUSES } from "@exegol/shared";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { restartNeeded, updateAndRestart, useCliUpdates } from "../../hooks/use-cli-updates";
import { useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";

const chip = "flex shrink-0 items-center gap-1 text-[9px]";

/** Live sessions of one CLI: an update restarts them all */
export function liveSessionsOf(cliType: string): string[] {
  return Object.values(useAgentStore.getState().agents)
    .filter((a) => a.cliType === cliType && LIVE_STATUSES.has(a.status))
    .map((a) => a.id);
}

/** Restart onto a CLI version installed since the session started (after this turn if it is
 *  working), or Update when a newer release is out: the command runs in a new tab you can see */
export function CliUpdateControl({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const pending = useCliRestartStore((s) => s.pending[agentId]);
  const status = useCliUpdates().get(agent?.cliType ?? "");
  if (!agent || !status) return null;

  if (pending) {
    return (
      <>
        <button
          type="button"
          onClick={() => useCliRestartStore.getState().cancel(agentId)}
          className={`${chip} text-accent hover:text-text-primary`}
          title={
            pending === "update"
              ? "Restarts once the update is installed and this turn ends. Click to cancel"
              : "Restarts on the new version when this turn ends. Click to cancel"
          }
        >
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          {pending === "update" ? "Restarts after the update" : "Restarts after this turn"}
        </button>
        <button
          type="button"
          onClick={() => useCliRestartStore.getState().request(agentId, "now")}
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
          updateAndRestart(agent.projectId, [cmd], liveSessionsOf(agent.cliType)).catch((err) =>
            console.error("[CliUpdate] Update failed to start:", err),
          )
        }
        className={`${chip} text-text-muted hover:text-text-primary`}
        title={`${status.latest} is out (installed: ${status.installed}). Runs \`${cmd}\` in a new tab, then restarts this CLI's sessions on it as each one is free (the conversation, model, YOLO and mode carry over)`}
      >
        <ArrowUpCircle className="h-2.5 w-2.5" />
        Update {status.latest}
      </button>
    );
  }
  return null;
}
