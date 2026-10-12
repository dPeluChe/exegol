import { LIVE_STATUSES } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { deleteAgent } from "../../hooks/use-delete-agent";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { trpcInvoke } from "../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { toastError } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

/** Read once: a session only leaves the list by restarting, which gives it a new id */
function useSessionsWithoutUtf8(): Set<string> {
  const { data } = useQuery({
    queryKey: ["sessionsWithoutUtf8"],
    queryFn: () => trpcInvoke<string[]>("doctor.sessionsWithoutUtf8"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return new Set(data ?? []);
}

/** A new shell in the same pane and folder (its OSC 7 cwd), then the old one closes */
async function restartShell(agent: AgentState, paneId: string): Promise<void> {
  const cwd = useWorkspaceStore.getState().paneCwd[paneId];
  await spawnShellIntoPane(agent.projectId, paneId, "Terminal", cwd).catch((err) => {
    if (!cwd) throw err;
    return spawnShellIntoPane(agent.projectId, paneId, "Terminal");
  });
  deleteAgent(agent.id);
}

/** Sessions begun before Exegol set a UTF-8 locale keep that environment: CocoaPods refuses to
 *  run and pbcopy stores Mac Roman. Restarting is the only fix */
export function LocaleRestartControl({ agentId, paneId }: { agentId: string; paneId?: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const noUtf8 = useSessionsWithoutUtf8();
  const pending = useCliRestartStore((s) => s.pending[agentId]);
  if (!agent || !noUtf8.has(agentId) || !LIVE_STATUSES.has(agent.status) || pending) return null;
  const shell = agent.cliType === "shell";
  if (shell && !paneId) return null;

  const restart = () => {
    if (shell && paneId) {
      restartShell(agent, paneId).catch(toastError("The terminal did not restart"));
    } else {
      useCliRestartStore.getState().request(agent.id);
    }
  };
  return (
    <button
      type="button"
      onClick={restart}
      className="flex shrink-0 items-center gap-1 text-[9px] text-warning hover:text-text-primary"
      title={
        shell
          ? "Started without UTF-8: CocoaPods (expo run:ios) fails and copied text turns into symbols. Opens a new terminal in this folder and closes this one, ending what runs in it"
          : "Started without UTF-8: CocoaPods (expo run:ios) fails and copied text turns into symbols. Restarts the session and resumes the conversation, with the same model, YOLO and mode (after its turn if it is working)"
      }
    >
      <TriangleAlert className="h-2.5 w-2.5" />
      No UTF-8: restart
    </button>
  );
}
