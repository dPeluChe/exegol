import { useNow } from "../../../hooks/use-now";
import { ACTIVITY_LABEL, deskActivity } from "../../../lib/company";
import { formatTimeAgo } from "../../../lib/format";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { useDeskActivityStore } from "../../../stores/desk-activity";
import { AgentIcon } from "../../common/AgentIcon";

const ORB_DELAYS_MS = [0, 150, 300];

function Since({ at }: { at: number }) {
  useNow();
  const ago = formatTimeAgo(at / 1000);
  return ago && ago !== "now" ? <span> · {ago}</span> : null;
}

/** The turn in progress: a transcript only grows when a message or a tool lands */
export function ChatWorking({ agent }: { agent: AgentState }) {
  const item = useAgentStore((s) => s.attentionItems[agent.id]);
  const lastActivity = useDeskActivityStore((s) => s.activity[agent.id]);
  const activity = deskActivity(agent, item, lastActivity);
  if (!activity) return null;
  return (
    <div role="status" className="flex items-center gap-2 text-[11px] text-text-muted">
      <AgentIcon provider={agent.cliType} size={16} />
      <span className="flex items-center gap-1" aria-hidden="true">
        {ORB_DELAYS_MS.map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span>
        {ACTIVITY_LABEL[activity]}
        {agent.activitySince && <Since at={agent.activitySince} />}
      </span>
    </div>
  );
}
