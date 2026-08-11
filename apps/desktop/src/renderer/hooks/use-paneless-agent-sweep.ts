import { useEffect, useRef } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { useWorkspaceStore } from "../stores/workspace";

const LIVE_STATUSES = new Set(["running", "spawning", "waiting_input", "paused"]);
const SWEEP_DELAY_MS = 6_000;
const SWEEP_INTERVAL_MS = 60_000;
const APP_START_MS = Date.now();

/** Every pane holding an agent, across ALL projects' persisted workspaces. */
function collectPanedAgentIds(): Set<string> {
  const ids = new Set<string>();
  const { projectWorkspaces } = useWorkspaceStore.getState();
  for (const pw of Object.values(projectWorkspaces)) {
    for (const pane of Object.values(pw.panes)) {
      if (pane.agentId) ids.add(pane.agentId);
    }
  }
  return ids;
}

/**
 * Verify round 3: closing a pane stops its agent, but an agent whose pane was
 * closed in a PREVIOUS app run reattaches paneless — unreachable, alive
 * forever, haunting the sidebar/attention inbox (factory-droid case). Sweep:
 * live agents with no pane anywhere get stopped (they land in Recent
 * sessions via their resume handle); terminal ones just drop their
 * attention item.
 */
export function usePanelessAgentSweep(): void {
  const attemptedStops = useRef(new Set<string>());
  useEffect(() => {
    const sweep = () => {
      const paned = collectPanedAgentIds();
      const { agents, attentionItems, dismissAttention } = useAgentStore.getState();
      for (const agent of Object.values(agents)) {
        if (paned.has(agent.id)) continue;
        if (LIVE_STATUSES.has(agent.status)) {
          // Only reap agents that PREDATE this app run: pipeline/scheduler/queue
          // agents spawned headless this session are paneless by design.
          const startedAt = agent.startedAt ? new Date(agent.startedAt).getTime() : 0;
          if (startedAt >= APP_START_MS) continue;
          if (attemptedStops.current.has(agent.id)) continue;
          attemptedStops.current.add(agent.id);
          console.log(`[PanelessSweep] Stopping paneless live agent ${agent.id}`);
          trpcMutate("agents.stop", { id: agent.id }).catch(() => {});
        } else if (attentionItems[agent.id]) {
          dismissAttention(agent.id);
        }
      }
    };
    // Delay past workspace hydration + reattach churn, then keep tidying.
    const initial = setTimeout(sweep, SWEEP_DELAY_MS);
    const interval = setInterval(sweep, SWEEP_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);
}
