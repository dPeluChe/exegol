import { cn } from "@exegol/ui";
import { Bot, Hand } from "lucide-react";
import { needsUserReason, useAgentBrowserPane } from "../../stores/agent-browser";

const btn =
  "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10";

/** "<alias> is using this browser": Take over pauses its tools, Hand back resumes them (and
 *  wakes an agent waiting in browser_wait_for_user) */
export function AgentBrowserBanner({ paneId }: { paneId: string }) {
  const state = useAgentBrowserPane(paneId);
  if (!state?.agentId || !(state.active || state.userHasControl)) return null;
  const alias = state.alias ?? "An agent";
  const ask = needsUserReason(state);
  const control = (action: "take-over" | "hand-back") =>
    void window.api.browser.control(paneId, action).catch(() => {});

  let text: string;
  if (ask) text = `${alias} needs you to ${ask}. Do it here, then hand back.`;
  else if (state.userHasControl) text = `You have control. ${alias} waits until you hand back.`;
  else text = `${alias} is using this browser`;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-2 py-1 text-[11px]",
        ask
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "border-accent/30 bg-accent/10 text-text-secondary",
      )}
    >
      {state.userHasControl && !ask ? (
        <Hand className="h-3 w-3 shrink-0" />
      ) : (
        <Bot className={cn("h-3 w-3 shrink-0", !ask && "animate-pulse text-accent")} />
      )}
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {!ask && !state.userHasControl && (
        <button
          type="button"
          className={cn(btn, "border-border")}
          onClick={() => control("take-over")}
        >
          Take over
        </button>
      )}
      {(ask || state.userHasControl) && (
        <button
          type="button"
          className={cn(btn, "border-amber-500/40")}
          onClick={() => control("hand-back")}
        >
          {ask ? "Done, hand back" : "Hand back"}
        </button>
      )}
    </div>
  );
}
