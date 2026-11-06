import {
  type AgentMessage,
  acceptsFollowUps,
  type ChatPage,
  type OlderChatPage,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, SendHorizontal } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { isClaudeQuestion } from "../../../lib/claude-question";
import { hasClipboardImage } from "../../../lib/clipboard-image";
import { answersPrompt } from "../../../lib/dictation/target";
import { fileDragToPaste, finderFilesToPaste, hasFileDragData } from "../../../lib/file-drag";
import {
  appendChatPage,
  type ChatHistory,
  chatSummary,
  chatTime,
  mergeChat,
  prependChatPage,
  type SessionBubble,
  toolsLine,
} from "../../../lib/session-chat";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { toastError } from "../../../stores/toasts";
import { AgentQuestion, useScreenDialog } from "../../agents/AgentQuestion";
import { AgentIcon } from "../../common/AgentIcon";
import { FollowUpList, useFollowUps } from "../../terminal/FollowUpControl";
import { DELIVERY, peerName, useAgentMessages } from "./AgentMessages";
import { ChatMarkdown } from "./ChatMarkdown";

const FALLBACK_POLL_MS = 15_000;
const NO_TURNS: ChatHistory["turns"] = [];
const NO_MESSAGES: AgentMessage[] = [];
const SHOWN_STEP = 100;

function useChat(agentId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["chatTurns", agentId];
  useMountEffect(() =>
    window.api.onChatUpdated((event) => {
      if (event.agentId !== agentId) return;
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["messages", "agent", agentId] });
    }),
  );
  const chat = useQuery({
    queryKey,
    queryFn: async () => {
      const cursor = queryClient.getQueryData<ChatHistory>(queryKey)?.cursor ?? undefined;
      const page = await trpcInvoke<ChatPage>("agents.chatTurns", { agentId, cursor });
      // Read after the wait: older turns may have landed meanwhile
      return appendChatPage(queryClient.getQueryData<ChatHistory>(queryKey), page);
    },
    refetchInterval: FALLBACK_POLL_MS,
  }).data;
  const older = useMutation({
    mutationFn: (before: string) =>
      trpcInvoke<OlderChatPage>("agents.chatOlder", { agentId, before }),
    onSuccess: (page, before) =>
      queryClient.setQueryData<ChatHistory>(
        queryKey,
        (held) => held && prependChatPage(held, page, before),
      ),
    onError: toastError("Could not load earlier messages"),
  });
  return { chat, older };
}

function PeerBubble({ message, agentId }: { message: AgentMessage; agentId: string }) {
  const incoming = message.toAgentId === agentId;
  const peer = useAgentStore((s) =>
    peerName(s.agents, incoming ? message.fromAgentId : message.toAgentId),
  );
  const delivery = message.deliveryState ? DELIVERY[message.deliveryState] : null;
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5">
      <p className="flex gap-1 text-[10px] text-text-muted">
        {incoming ? `From ${peer}` : `To ${peer}`}
        {delivery && <span className={cn("ml-auto", delivery.tone)}>{delivery.label}</span>}
      </p>
      <div className="text-xs text-text-secondary">
        <ChatMarkdown text={message.content} agentId={agentId} />
      </div>
    </div>
  );
}

// Memo: a push appends one bubble and leaves the rest of a 200-turn list alone
const Bubble = memo(function Bubble({
  bubble,
  agentId,
  cliType,
  formatted,
}: {
  bubble: SessionBubble;
  agentId: string;
  cliType: string;
  formatted: boolean;
}) {
  if (bubble.kind === "tools") {
    return <p className="truncate pl-6 text-[10px] text-text-muted">{toolsLine(bubble.names)}</p>;
  }
  if (bubble.kind === "peer") return <PeerBubble message={bubble.message} agentId={agentId} />;
  const time = bubble.at !== null ? chatTime(bubble.at) : null;
  if (bubble.role === "user") {
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-0.5 self-end">
        <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent/20 px-3 py-1.5 text-xs text-text-primary">
          {bubble.text}
        </p>
        {time && <span className="pr-1 text-[9px] text-text-muted">{time}</span>}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 gap-2">
      <span className="mt-1 shrink-0">
        <AgentIcon provider={cliType} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="rounded-2xl rounded-tl-sm bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
          {formatted ? (
            <ChatMarkdown text={bubble.text} agentId={agentId} />
          ) : (
            <p className="whitespace-pre-wrap break-words font-mono text-[11px]">{bubble.text}</p>
          )}
        </div>
        {time && <span className="pl-1 text-[9px] text-text-muted">{time}</span>}
      </div>
    </div>
  );
});

// Moving between sessions remounts the input: what was being typed waits for the way back
const drafts = new Map<string, string>();

function ChatInput({ agent, onTerminal }: { agent: AgentState; onTerminal: () => void }) {
  const [draft, setDraftText] = useState(() => drafts.get(agent.id) ?? "");
  const setDraft = (text: string) => {
    setDraftText(text);
    if (text) drafts.set(agent.id, text);
    else drafts.delete(agent.id);
  };
  const accepts = acceptsFollowUps(agent);
  const dialog = useScreenDialog(agent.id, accepts);
  const attention = useAgentStore((s) => s.attentionItems[agent.id]);
  const claudeAsks = isClaudeQuestion(attention, agent);
  const asks = answersPrompt({
    status: agent.status,
    dialogOnScreen: !!dialog,
    awaitingAnswer: claudeAsks,
  });
  const atPrompt = agent.status === "waiting_input" || agent.status === "idle";
  const queued = useFollowUps(agent.id, accepts);

  // From the map: a saved image lands after renders that may have changed the draft
  const attach = (text: string) => {
    const now = drafts.get(agent.id) ?? "";
    setDraft(`${now}${now && !now.endsWith(" ") ? " " : ""}${text}`);
  };
  const [dropping, setDropping] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (text: string) =>
      trpcMutate<{ delivered: boolean }>("agents.queueFollowUp", { id: agent.id, text }),
    onSuccess: (result, text) => {
      setDraft("");
      setTyped(result.delivered ? text : null);
    },
    onError: toastError("Could not send"),
  });
  const submit = () => {
    const text = draft.trim();
    if (text && !send.isPending) send.mutate(text);
  };

  if (!accepts) {
    return (
      <button
        type="button"
        onClick={onTerminal}
        className="border-t border-border p-2 text-left text-[11px] text-accent hover:underline"
      >
        The CLI exited: continue in the terminal
      </button>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target, the input inside takes the keyboard
    <div
      className={cn("flex flex-col gap-1.5 border-t border-border p-2", dropping && "bg-accent/10")}
      onDragOver={(e) => {
        if (!hasFileDragData(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const text = fileDragToPaste(e);
        if (!text) return;
        e.preventDefault();
        attach(text);
      }}
    >
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
      {queued.length > 0 && <FollowUpList agentId={agent.id} items={queued} />}
      {typed && (
        <p className="truncate text-[10px] text-text-muted">Typed in the terminal: {typed}</p>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          data-chat-input
          value={draft}
          rows={2}
          disabled={asks}
          onChange={(e) => {
            setDraft(e.target.value);
            setTyped(null);
          }}
          onPaste={(e) => {
            const files = finderFilesToPaste(e.clipboardData);
            if (!files && !hasClipboardImage(e.clipboardData)) return;
            e.preventDefault();
            if (files) attach(files);
            else
              void window.api.terminal.saveClipboardImage().then((path) => {
                if (path) attach(`${path} `);
              });
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          placeholder={
            asks
              ? "Answer its question first"
              : atPrompt
                ? "Message this session"
                : "Sends when this turn ends"
          }
          aria-label="Message this session"
          className="min-w-0 flex-1 resize-none rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={asks || !draft.trim() || send.isPending}
          title="Send"
          className="shrink-0 rounded bg-accent p-1.5 text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <SendHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The session as turns. Text scraped from the terminal is not Markdown: it stays as printed */
export function CompanyChat({
  agent,
  where,
  onTerminal,
}: {
  agent: AgentState;
  where: string;
  onTerminal: () => void;
}) {
  const { chat, older } = useChat(agent.id);
  const turns = chat?.turns ?? NO_TURNS;
  const [shown, setShown] = useState(SHOWN_STEP);
  const { data: messages = NO_MESSAGES } = useAgentMessages(agent.id);
  const bubbles = useMemo(() => mergeChat(turns, messages, agent.id), [turns, messages, agent.id]);
  const showEarlier = () => {
    setShown(shown + SHOWN_STEP);
    if (chat?.older && bubbles.length < shown + SHOWN_STEP) older.mutate(chat.older);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2.5 pt-1.5 text-[10px] text-text-muted">
        <span className="flex-1">{chat?.fromTerminal ? "From the terminal" : ""}</span>
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
        <div className="flex flex-col gap-3">
          {(bubbles.length > shown || chat?.older) && (
            <button
              type="button"
              onClick={showEarlier}
              disabled={older.isPending}
              className="self-center rounded-full border border-border px-3 py-1 text-[10px] text-text-muted hover:text-text-primary disabled:opacity-60"
            >
              {older.isPending ? "Loading" : "Earlier messages"}
            </button>
          )}
          {bubbles.length === 0 && chat && (
            <p className="text-xs text-text-muted">Nothing to show yet.</p>
          )}
          {bubbles.slice(-shown).map((bubble) => (
            <Bubble
              key={bubble.id}
              bubble={bubble}
              agentId={agent.id}
              cliType={agent.cliType}
              formatted={!chat?.fromTerminal}
            />
          ))}
        </div>
      </div>
      <ChatInput agent={agent} onTerminal={onTerminal} />
    </div>
  );
}
