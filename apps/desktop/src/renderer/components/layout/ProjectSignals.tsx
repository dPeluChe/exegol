import { BellDot, BellOff } from "lucide-react";
import { useGitHubOverview } from "../../hooks/use-trpc";
import { needsYou } from "../../lib/agent-groups";
import { isLiveSession } from "../../lib/sidebar-views";
import { useAgentStore } from "../../stores/agents";
import { useNotificationPrefsStore } from "../../stores/notification-prefs";
import { GitHubCounts } from "../common/GitHubCounts";

export function ProjectSignals({ projectId }: { projectId: string }) {
  const waiting = useAgentStore((s) =>
    Object.values(s.attentionItems).some((item) => {
      if (item.projectId !== projectId) return false;
      const agent = s.agents[item.agentId];
      return !!agent && needsYou(agent, item);
    }),
  );
  // Each project polled costs two `gh` calls, so only those with a session running
  const live = useAgentStore((s) =>
    Object.values(s.agents).some((a) => a.projectId === projectId && isLiveSession(a)),
  );
  const level = useNotificationPrefsStore((s) => s.levelOf(projectId));
  const { data: overview } = useGitHubOverview(live ? projectId : null);

  return (
    <>
      {level === "none" && (
        <BellOff className="h-2.5 w-2.5 shrink-0 text-text-muted" aria-label="Interruptions off" />
      )}
      {level === "needs-me" && (
        <BellDot className="h-2.5 w-2.5 shrink-0 text-text-muted" aria-label="Only what needs me" />
      )}
      <GitHubCounts prs={overview?.prs ?? []} issues={overview?.issues ?? []} />
      {waiting && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Needs you" />
      )}
    </>
  );
}
