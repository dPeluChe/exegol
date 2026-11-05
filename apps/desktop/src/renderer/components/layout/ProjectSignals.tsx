import { BellDot, BellOff } from "lucide-react";
import { useGitHubOverview } from "../../hooks/use-trpc";
import { needsYou } from "../../lib/agent-groups";
import { isLiveSession } from "../../lib/sidebar-views";
import { useAgentStore } from "../../stores/agents";
import { useNotificationPrefsStore } from "../../stores/notification-prefs";

export function ProjectSignals({ projectId }: { projectId: string }) {
  const waiting = useAgentStore((s) =>
    Object.values(s.attentionItems).some((item) => {
      if (item.projectId !== projectId) return false;
      const agent = s.agents[item.agentId];
      return !!agent && needsYou(agent, item);
    }),
  );
  // Each project polled costs `gh` calls (main caps them per poll), so only those with a session
  const live = useAgentStore((s) =>
    Object.values(s.agents).some((a) => a.projectId === projectId && isLiveSession(a)),
  );
  const level = useNotificationPrefsStore((s) => s.levelOf(projectId));
  const { data: overview } = useGitHubOverview(live ? projectId : null);
  const prs = overview?.prs ?? [];
  const failing = prs.filter((pr) => pr.ci === "failing").length;

  return (
    <>
      {level === "none" && (
        <BellOff className="h-2.5 w-2.5 shrink-0 text-text-muted" aria-label="Interruptions off" />
      )}
      {level === "needs-me" && (
        <BellDot className="h-2.5 w-2.5 shrink-0 text-text-muted" aria-label="Only what needs me" />
      )}
      {prs.length > 0 && (
        <span
          className={`shrink-0 text-[9px] tabular-nums ${failing > 0 ? "text-error" : "text-text-muted"}`}
          title={`${prs.length} open PR${prs.length === 1 ? "" : "s"}${failing > 0 ? `, ${failing} with CI failing` : ""}`}
        >
          PR {prs.length}
        </span>
      )}
      {waiting && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Needs you" />
      )}
    </>
  );
}
