import { useCallback } from "react";
import type { useStopAgent } from "../../hooks/use-trpc";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { useToastStore } from "../../stores/toasts";

/** T155 (verify session): a "Failed to start" pane becomes a plain shell in
 *  the same project so the user can diagnose (rerun the CLI by hand, etc.) */
export function useOpenShellHere({
  agentId,
  paneId,
  agentProjectId,
  paneProjectId,
  stopAgent,
}: {
  agentId: string;
  paneId: string | undefined;
  agentProjectId: string | undefined;
  paneProjectId: string | null | undefined;
  stopAgent: ReturnType<typeof useStopAgent>;
}) {
  return useCallback(async () => {
    // A "Failed to start" agent may already be gone from store+DB — fall back
    // to the project of the pane.
    const pid = agentProjectId ?? paneProjectId;
    if (!pid || !paneId) {
      useToastStore.getState().addToast({
        type: "error",
        title: "Open Terminal failed",
        body: !pid ? "No active project" : "Pane not resolved",
      });
      return;
    }
    try {
      await spawnShellIntoPane(pid, paneId, "Shell");
      // Stop the dead agent AFTER the pane swapped — stopping first raced the
      // pane cleanup and the button appeared to do nothing.
      stopAgent.mutate(agentId);
    } catch (err) {
      useToastStore.getState().addToast({
        type: "error",
        title: "Open Terminal failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }, [agentProjectId, paneProjectId, paneId, agentId, stopAgent]);
}
