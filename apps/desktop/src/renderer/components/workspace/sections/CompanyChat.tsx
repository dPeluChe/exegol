import { acceptsFollowUps, type ChatPage, LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, X } from "lucide-react";
import { useState } from "react";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { useResumeAgent } from "../../../hooks/use-resume-agent";
import { agentAsksQuestion } from "../../../lib/agent-question";
import { isClaudeQuestion } from "../../../lib/claude-question";
import {
  appendChatPage,
  type ChatBubble,
  type ChatHistory,
  chatSummary,
  mergeChat,
  sendDecision,
  toolsLine,
} from "../../../lib/session-chat";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { toastError } from "../../../stores/toasts";
import { AgentQuestion, useScreenDialog } from "../../agents/AgentQuestion";
import { useFollowUps } from "../../terminal/FollowUpControl";

const FALLBACK_POLL_MS = 15_000;

function useChat(agentId: string): ChatHistory | undefined {
  const queryClient = useQueryClient();
  const queryKey = ["chatTurns", agentId];
  useMountEffect(() =>
    window.api.onChatUpdated((event) => {
      if (event.agentId === agentId) void queryClient.invalidateQueries({ queryKey });
    }),
  );
  return useQuery({
    queryKey,
    queryFn: async () => {
      const prev = queryClient.getQueryData<ChatHistory>(queryKey);
      const page = await trpcInvoke<ChatPage>("agents.chatTurns", {
        agentId,
        cursor: prev?.cursor ?? undefined,
      });
      return appendChatPage(prev, page);
    },
    refetchInterval: FALLBACK_POLL_MS,
  }).data;
}

function Bubble({ bubble }: { bubble: ChatBubble }) {
  if (bubble.kind === "tools") {
    return <p className="truncate text-[10px] text-text-muted">{toolsLine(bubble.names)}</p>;
  }
  if (bubble.kind === "peer") {
    const { peer } = bubble;
    return (
      <div className="rounded-lg border border-border px-2.5 py-1.5">
        <p className="text-[10px] text-text-muted">
          {peer.incoming ? `From ${peer.peer}` : `To ${peer.peer}`}
          {peer.delivery ? ` · ${peer.delivery}` : ""}
        </p>
        <p className="whitespace-pre-wrap break-words text-xs text-text-secondary">{peer.text}</p>
      </div>
    );
  }
  const mine = bubble.role === "user";
  return (
    <p
      className={cn(
        "max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs",
        mine
          ? "self-end bg-accent/15 text-text-primary"
          : "self-start bg-bg-tertiary text-text-primary",
      )}
    >
      {bubble.text}
    </p>
  );
}

function ChatInput({ agent, onTerminal }: { agent: AgentState; onTerminal: () => void }) {
  const [draft, setDraft] = useState("");
  const live = LIVE_STATUSES.has(agent.status);
  const accepts = acceptsFollowUps(agent);
  const dialog = useScreenDialog(agent.id, accepts);
  const attention = useAgentStore((s) => s.attentionItems[agent.id]);
  const claudeAsks = isClaudeQuestion(attention, agent);
  const decision = sendDecision({
    accepts,
    status: agent.status,
    asks: !!dialog || claudeAsks,
  });
  const queued = useFollowUps(agent.id, accepts);
  const { resume, pending, resumableCliTypes } = useResumeAgent();

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (await agentAsksQuestion(agent.id)) return false;
      await trpcMutate("agents.queueFollowUp", { id: agent.id, text });
      return true;
    },
    onSuccess: (sent) => {
      if (sent) setDraft("");
    },
    onError: toastError("Could not send"),
  });
  const cancel = useMutation({
    mutationFn: (itemId: string) => trpcMutate("agents.removeFollowUp", { id: agent.id, itemId }),
    onError: toastError("Could not cancel"),
  });
  const submit = () => {
    const text = draft.trim();
    if (text && !send.isPending && decision !== "closed" && decision !== "question") {
      send.mutate(text);
    }
  };

  if (decision === "closed") {
    return (
      <div className="flex items-center gap-2 border-t border-border p-2 text-[11px] text-text-muted">
        {live ? (
          <button type="button" onClick={onTerminal} className="text-accent hover:underline">
            The CLI exited: continue in the terminal
          </button>
        ) : (
          <>
            <span className="flex-1">This session ended.</span>
            {resumableCliTypes.has(agent.cliType) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void resume(agent).catch(() => {})}
                className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Resume
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border p-2">
      {dialog ? (
        <AgentQuestion agentId={agent.id} enabled={accepts} />
      ) : (
        claudeAsks && (
          <button
            type="button"
            onClick={onTerminal}
            className="self-start text-[11px] text-accent hover:underline"
          >
            Answer in the terminal
          </button>
        )
      )}
      {queued.map((item) => (
        <div key={item.id} className="flex items-center gap-1 text-[10px] text-text-muted">
          <span className="shrink-0">Queued</span>
          <span className="min-w-0 flex-1 truncate">{item.text}</span>
          <button
            type="button"
            aria-label="Cancel queued message"
            onClick={() => cancel.mutate(item.id)}
            className="shrink-0 hover:text-text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <textarea
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
        placeholder={decision === "queue" ? "Sends when this turn ends" : "Message this session"}
        aria-label="Message this session"
        className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
      />
    </div>
  );
}

/** The session as turns, plain text only: links and markup in agent output stay inert */
export function CompanyChat({
  agent,
  where,
  onTerminal,
}: {
  agent: AgentState;
  where: string;
  onTerminal: () => void;
}) {
  const chat = useChat(agent.id);
  const turns = chat?.turns ?? [];
  const bubbles = mergeChat(turns, chat?.peers ?? []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2.5 pt-1.5 text-[10px] text-text-muted">
        <span className="flex-1">{chat?.source === "terminal" ? "From the terminal" : ""}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(chatSummary(turns, where, agent.status))
          }
          className="flex items-center gap-1 hover:text-text-primary"
        >
          <Copy className="h-3 w-3" />
          Copy summary
        </button>
      </div>
      {/* column-reverse keeps the newest turn in view without tracking scroll */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-2.5 py-2">
        <div className="flex flex-col gap-1.5">
          {bubbles.length === 0 && chat && (
            <p className="text-xs text-text-muted">Nothing to show yet.</p>
          )}
          {bubbles.map((bubble) => (
            <Bubble key={bubble.id} bubble={bubble} />
          ))}
        </div>
      </div>
      <ChatInput agent={agent} onTerminal={onTerminal} />
    </div>
  );
}
