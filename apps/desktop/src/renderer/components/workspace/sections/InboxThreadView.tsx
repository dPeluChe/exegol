import {
  type AgentCliType,
  atInboxTurnLimit,
  INBOX_BODY_MAX,
  INBOX_RESOLUTION_MAX,
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
import { useLaunchableProviders } from "../../../hooks/use-providers";
import { useGitHubOverview } from "../../../hooks/use-trpc-github";
import { sessionName } from "../../../lib/agent-label";
import { startInNewTab, takesPrompt } from "../../../lib/github-handoff";
import { sessionsInRepoFirst, sessionsOfNamedRepo } from "../../../lib/github-repos";
import { openInBrowser } from "../../../lib/open-in-browser";
import { isOpenSession } from "../../../lib/sidebar-views";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { toastError, useToastStore } from "../../../stores/toasts";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { AgentIcon } from "../../common/AgentIcon";
import { PickButton } from "../../common/PickButton";
import type { ProjectMeta } from "../../common/ProjectChip";
import { inboxPlace } from "../inbox-place";

interface ThreadData {
  thread: InboxThread;
  messages: InboxMessage[];
  refs: InboxThread[];
}

function authorLabel(m: InboxMessage, name: string | null): string {
  if (m.authorKind === "user") return "You";
  if (m.authorKind === "external") return "Captured";
  const cli = m.cli === name ? null : m.cli;
  return [name, cli, m.model, m.repo, m.branch, m.commit].filter(Boolean).join(", ") || "Agent";
}

function Message({ message }: { message: InboxMessage }) {
  const name = useAgentStore((s) => {
    const session = message.agentId ? s.agents[message.agentId] : undefined;
    return session ? sessionName(session) : null;
  });
  return (
    <article className="rounded-lg border border-border bg-bg-primary px-3 py-2">
      <header className="mb-1 flex justify-between gap-3 text-[10px] text-text-muted">
        <span className="truncate">{authorLabel(message, name)}</span>
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

function SendToSession({
  thread,
  repo,
  homeProject,
}: {
  thread: InboxThread;
  repo: string | null;
  homeProject: string | null;
}) {
  const projectId = thread.scope === "personal" ? null : thread.scopeId;
  const sessions = useAgentStore(
    useShallow((s) =>
      Object.values(s.agents).filter(
        (a) => isOpenSession(a) && (!projectId || a.projectId === projectId),
      ),
    ),
  );
  const { busy, act } = useAct(thread.id);
  const tabProject = projectId ?? homeProject;
  const clis = useLaunchableProviders().filter(takesPrompt);
  const { data: overview } = useGitHubOverview(repo ? projectId : null);
  const ordered = sessionsInRepoFirst(sessions, sessionsOfNamedRepo(overview?.repos ?? [], repo));

  const startInTab = async (cliType: AgentCliType) => {
    if (!tabProject) return;
    const started = await act<{ prompt: string; branch: string; useWorktree: boolean }>(
      "inbox.startSession",
      { projectId: tabProject },
    );
    if (!started) return;
    const { prompt, branch, useWorktree } = started;
    await startInNewTab(tabProject, cliType, {
      taskDescription: prompt,
      useWorktree,
      branchName: branch,
    }).catch(toastError(`${thread.id}: session not started`));
  };

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
      {ordered.length === 0 && (
        <span className="px-3 py-1 text-text-muted">No open sessions here</span>
      )}
      {ordered.map((session) => (
        <PickButton
          key={session.id}
          name={sessionName(session)}
          disabled={busy}
          onClick={() => void send(session)}
        >
          <AgentIcon provider={session.cliType} size={14} />
        </PickButton>
      ))}
      {tabProject && <span className="px-3 py-1 text-[10px] text-text-muted">New tab</span>}
      {tabProject &&
        clis.map((cli) => (
          <PickButton
            key={cli.id}
            name={cli.name}
            disabled={busy}
            onClick={() => void startInTab(cli.id as AgentCliType)}
          >
            <AgentIcon provider={cli.id} size={14} fallback={cli.icon} fallbackColor={cli.color} />
          </PickButton>
        ))}
    </div>
  );
}

function Actions({
  thread,
  repo,
  homeProject,
}: {
  thread: InboxThread;
  repo: string | null;
  homeProject: string | null;
}) {
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
        <SendToSession thread={thread} repo={repo} homeProject={homeProject} />
      )}
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={2}
        maxLength={INBOX_BODY_MAX}
        placeholder="Your message, read when a session opens the thread"
        className={INPUT_CLASS}
      />
      <div className="flex items-center gap-2">
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          maxLength={INBOX_RESOLUTION_MAX}
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
  homeProject = null,
  onOpen,
}: {
  id: string;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
  /** Where New tab starts a personal thread, which belongs to no project */
  homeProject?: string | null;
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
      {!closed && (
        <Actions thread={thread} repo={messages[0]?.repo ?? null} homeProject={homeProject} />
      )}
    </div>
  );
}
