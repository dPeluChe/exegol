import {
  atInboxTurnLimit,
  INBOX_TURN_LIMIT,
  type InboxCloseStatus,
  type InboxMessage,
  type InboxThread,
  isInboxClosed,
} from "@exegol/shared";
import { Button, ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { sessionName } from "../../../lib/agent-label";
import { openInBrowser } from "../../../lib/open-in-browser";
import { isOpenSession } from "../../../lib/sidebar-views";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { toastError, useToastStore } from "../../../stores/toasts";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { AgentIcon } from "../../common/AgentIcon";
import { PickButton } from "../../common/PickButton";
import type { ProjectMeta } from "../../common/ProjectChip";

interface ThreadData {
  thread: InboxThread;
  messages: InboxMessage[];
  refs: InboxThread[];
}

export const inboxPlace = (thread: InboxThread, meta: ReadonlyMap<string, ProjectMeta>) =>
  thread.scope === "personal"
    ? "Personal"
    : (meta.get(thread.scopeId ?? "")?.name ?? thread.scopeId ?? "");

function authorLabel(m: InboxMessage): string {
  if (m.authorKind === "user") return "You";
  if (m.authorKind === "external") return "Captured";
  return [m.cli, m.model, m.repo, m.branch, m.commit].filter(Boolean).join(", ") || "Agent";
}

function Message({ message }: { message: InboxMessage }) {
  return (
    <article className="rounded-lg border border-border bg-bg-primary px-3 py-2">
      <header className="mb-1 flex justify-between gap-3 text-[10px] text-text-muted">
        <span className="truncate">{authorLabel(message)}</span>
        <time className="shrink-0">{new Date(message.createdAt * 1000).toLocaleString()}</time>
      </header>
      <p className="whitespace-pre-wrap break-words text-xs text-text-primary">{message.body}</p>
    </article>
  );
}

function useAct(id: string) {
  const [busy, setBusy] = useState(false);
  const act = async <T,>(path: string, input: object): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await trpcMutate<T>(path, { id, ...input });
    } catch (err) {
      toastError(`${id}: not done`)(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

function SendToSession({ thread }: { thread: InboxThread }) {
  const projectId = thread.scope === "personal" ? null : thread.scopeId;
  const sessions = useAgentStore(
    useShallow((s) =>
      Object.values(s.agents).filter(
        (a) => isOpenSession(a) && (!projectId || a.projectId === projectId),
      ),
    ),
  );
  const { busy, act } = useAct(thread.id);

  const send = async (session: AgentState) => {
    const sent = await act<{ delivered: boolean }>("inbox.sendToSession", {
      agentId: session.id,
    });
    if (!sent) return;
    useToastStore.getState().addToast({
      type: "info",
      title: `${thread.id} ${sent.delivered ? "sent to" : "queued for"} ${sessionName(session)}`,
    });
  };

  return (
    <div className="flex max-h-32 flex-col overflow-y-auto text-xs">
      <span className="px-3 py-1 text-[10px] text-text-muted">Send to session</span>
      {sessions.length === 0 && (
        <span className="px-3 py-1 text-text-muted">No open sessions here</span>
      )}
      {sessions.map((session) => (
        <PickButton
          key={session.id}
          name={sessionName(session)}
          disabled={busy}
          onClick={() => void send(session)}
        >
          <AgentIcon provider={session.cliType} size={14} />
        </PickButton>
      ))}
    </div>
  );
}

function Actions({ thread }: { thread: InboxThread }) {
  const { busy, act } = useAct(thread.id);
  const [reply, setReply] = useState("");
  const [line, setLine] = useState("");
  const atLimit = atInboxTurnLimit(thread);
  const sendReply = async () => {
    if ((await act("inbox.reply", { body: reply })) !== undefined) setReply("");
  };
  const closeAs = (status: InboxCloseStatus) => act("inbox.close", { status, resolution: line });

  return (
    <footer className="flex flex-col gap-2 border-t border-border p-2">
      {atLimit ? (
        <div className="flex items-center gap-2 text-xs text-warning">
          <span className="min-w-0 flex-1">
            {INBOX_TURN_LIMIT} agent messages: close it or give one last turn.
          </span>
          <Button size="sm" disabled={busy} onClick={() => void act("inbox.lastTurn", {})}>
            One last turn
          </Button>
        </div>
      ) : (
        <SendToSession thread={thread} />
      )}
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={2}
        maxLength={8_000}
        placeholder="Your message, read when a session opens the thread"
        className={INPUT_CLASS}
      />
      <div className="flex items-center gap-2">
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          maxLength={200}
          placeholder="One line on how it ended, to close"
          className={INPUT_CLASS}
        />
        <Button size="sm" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
          Reply
        </Button>
        <Button size="sm" disabled={busy || !line.trim()} onClick={() => void closeAs("resolved")}>
          Resolve
        </Button>
        <Button size="sm" disabled={busy || !line.trim()} onClick={() => void closeAs("dismissed")}>
          Dismiss
        </Button>
      </div>
    </footer>
  );
}

export function InboxThreadView({
  id,
  projectMeta,
  onOpen,
}: {
  id: string;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
  onOpen: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["inbox", "thread", id],
    queryFn: () => trpcInvoke<ThreadData>("inbox.get", { id }),
  });
  if (!data) return null;
  const { thread, messages, refs } = data;
  const closed = isInboxClosed(thread.status);
  const url = thread.url;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-3 py-2">
        <h3 className="truncate text-xs font-semibold text-text-primary">{thread.title}</h3>
        <p className="truncate text-[10px] text-text-muted">
          {thread.id}, {inboxPlace(thread, projectMeta)}, {thread.agentTurns} of {INBOX_TURN_LIMIT}{" "}
          agent messages
        </p>
        {url && (
          <button
            type="button"
            onClick={() => openInBrowser(url)}
            className="block max-w-full truncate text-[10px] text-accent hover:underline"
          >
            {url}
          </button>
        )}
        {refs.map((ref) => (
          <button
            key={ref.id}
            type="button"
            onClick={() => onOpen(ref.id)}
            className="block max-w-full truncate text-[10px] text-text-secondary hover:underline"
          >
            {ref.id} {ref.title}: {ref.resolution}
          </button>
        ))}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {messages.map((message) => (
            <Message key={message.seq} message={message} />
          ))}
          {closed && (
            <p className="text-xs text-text-secondary">
              {thread.status}: {thread.resolution}
            </p>
          )}
        </div>
      </ScrollArea>
      {!closed && <Actions thread={thread} />}
    </div>
  );
}
