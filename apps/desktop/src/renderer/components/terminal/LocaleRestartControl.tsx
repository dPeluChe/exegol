import { LIVE_STATUSES } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { replaceShellInPane } from "../../lib/split-terminal";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { toastError } from "../../stores/toasts";

const WHY =
  "Started without UTF-8: CocoaPods (expo run:ios) fails and copied text turns into symbols";

/** Read once: a session only leaves the list by restarting, which gives it a new id */
function useStartedWithoutUtf8(agentId: string): boolean {
  const { data } = useQuery({
    queryKey: ["sessionsWithoutUtf8"],
    queryFn: () => trpcInvoke<string[]>("doctor.sessionsWithoutUtf8"),
    staleTime: Number.POSITIVE_INFINITY,
    select: (ids) => ids.includes(agentId),
  });
  return data ?? false;
}

/** Restart for a session begun before Exegol set a UTF-8 locale (main/agents/session-locale.ts) */
export function LocaleRestartControl({ agentId, paneId }: { agentId: string; paneId?: string }) {
  const flagged = useStartedWithoutUtf8(agentId);
  const agent = useAgentStore((s) => (flagged ? s.agents[agentId] : undefined));
  const pending = useCliRestartStore((s) => s.pending[agentId]);
  if (!agent || !LIVE_STATUSES.has(agent.status) || pending) return null;
  const shell = agent.cliType === "shell";
  if (shell && !paneId) return null;

  const restart = () => {
    if (shell && paneId) {
      replaceShellInPane(agent.projectId, paneId, agentId).catch(
        toastError("The terminal did not restart"),
      );
    } else {
      useCliRestartStore.getState().request(agentId);
    }
  };
  return (
    <button
      type="button"
      onClick={restart}
      className="flex shrink-0 items-center gap-1 text-[9px] text-warning hover:text-text-primary"
      title={
        shell
          ? `${WHY}. Opens a new terminal in this folder and closes this one, ending what runs in it`
          : `${WHY}. Restarts the session and resumes the conversation (after its turn if it is working)`
      }
    >
      <TriangleAlert className="h-2.5 w-2.5" />
      No UTF-8: restart
    </button>
  );
}
