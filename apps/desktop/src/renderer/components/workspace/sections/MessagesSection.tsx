import type { AgentMessage, AgentMessageType } from "@exegol/shared";
import { Badge, Button, cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MailOpen, Send, X } from "lucide-react";
import { useState } from "react";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { EmptyState } from "../../common/EmptyState";

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useMessages(agentId?: string) {
  return useQuery({
    queryKey: ["messages", agentId ?? "all"],
    queryFn: () => trpcInvoke<AgentMessage[]>("messages.list", agentId ? { agentId } : undefined),
    refetchInterval: 15_000,
  });
}

function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      fromAgentId: string | null;
      toAgentId: string | null;
      type: AgentMessageType;
      content: string;
    }) => trpcMutate<AgentMessage>("messages.send", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("messages.markRead", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TYPE_COLORS: Record<AgentMessageType, string> = {
  text: "bg-gray-500/20 text-gray-400",
  handoff: "bg-blue-500/20 text-blue-400",
  status: "bg-green-500/20 text-green-400",
  request: "bg-yellow-500/20 text-yellow-400",
  result: "bg-purple-500/20 text-purple-400",
};

// ─── Compose Dialog ──────────────────────────────────────────────────────────

function ComposeDialog({ onClose }: { onClose: () => void }) {
  const sendMessage = useSendMessage();
  const [content, setContent] = useState("");
  const [toAgentId, setToAgentId] = useState("");
  const [type, setType] = useState<AgentMessageType>("text");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage.mutateAsync({
      fromAgentId: null, // From the user/orchestrator
      toAgentId: toAgentId || null,
      type,
      content,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-bg-primary p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Send Message</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">To Agent ID (optional)</div>
            <input
              value={toAgentId}
              onChange={(e) => setToAgentId(e.target.value)}
              placeholder="Leave empty for broadcast"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AgentMessageType)}
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="text">Text</option>
              <option value="status">Status</option>
              <option value="request">Request</option>
              <option value="result">Result</option>
              <option value="handoff">Handoff</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Content</div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Message content..."
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              rows={4}
              required
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} className="text-xs text-text-muted">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!content || sendMessage.isPending}
            className="gap-1 bg-accent text-xs text-white"
          >
            <Send className="h-3 w-3" />
            {sendMessage.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Message Row ─────────────────────────────────────────────────────────────

function MessageRow({ message }: { message: AgentMessage }) {
  const markRead = useMarkRead();
  const isUnread = !message.readAt;

  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-bg-secondary px-3 py-2.5",
        isUnread && "border-accent/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge className={cn("text-[10px]", TYPE_COLORS[message.type])}>{message.type}</Badge>
        <span className="text-[10px] text-text-muted">
          {message.fromAgentId ? `From: ${message.fromAgentId.slice(0, 8)}` : "System"}
        </span>
        {message.toAgentId && (
          <span className="text-[10px] text-text-muted">To: {message.toAgentId.slice(0, 8)}</span>
        )}
        <span className="ml-auto text-[10px] text-text-muted">{formatTime(message.createdAt)}</span>
        {isUnread && (
          <button
            type="button"
            onClick={() => markRead.mutate(message.id)}
            className="rounded p-0.5 text-text-muted hover:text-accent"
            title="Mark as read"
          >
            <MailOpen className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs text-text-primary">{message.content}</p>
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────────────────

export function MessagesSection() {
  const { data: messages } = useMessages();
  const [showCompose, setShowCompose] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Messages</h2>
        <Button
          type="button"
          onClick={() => setShowCompose(true)}
          className="gap-1 bg-accent text-[11px] text-white"
        >
          <Send className="h-3 w-3" />
          New Message
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {messages && messages.length > 0 ? (
          <div className="space-y-2">
            {messages.map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Mail className="h-8 w-8 text-text-muted" />}
            title="No messages"
            description="Inter-agent messages will appear here. Send messages between agents to coordinate work."
          />
        )}
      </div>

      {showCompose && <ComposeDialog onClose={() => setShowCompose(false)} />}
    </div>
  );
}
