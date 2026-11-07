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
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { FilterChip } from "../../common/FilterChip";
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
  const [picking, setPicking] = useState(false);
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
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-text-muted">Send to</span>
        {ordered.length === 0 && (
          <span className="text-[10px] text-text-muted">no open session here,</span>
        )}
        {ordered.map((session) => (
          <FilterChip
            key={session.id}
            active={false}
            className={CHIP}
            disabled={busy}
            onClick={() => void send(session)}
          >
            <AgentIcon provider={session.cliType} size={12} />
            {sessionName(session)}
          </FilterChip>
        ))}
        {tabProject && (
          <FilterChip
            active={picking}
            className={CHIP}
            disabled={busy}
            onClick={() => setPicking(!picking)}
          >
            <Plus className="h-3 w-3" />
            New tab
          </FilterChip>
        )}
      </div>
      {picking && (
        <div className="flex flex-wrap gap-1">
          {clis.map((cli) => (
            <FilterChip
              key={cli.id}
              active={false}
              className={CHIP}
              disabled={busy}
              onClick={() => void startInTab(cli.id as AgentCliType)}
            >
              <AgentIcon
                provider={cli.id}
                size={12}
                fallback={cli.icon}
                fallbackColor={cli.color}
              />
              {cli.name}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  );
}

const CHIP =
  "flex max-w-40 items-center gap-1 truncate border border-border text-[11px] text-text-primary";

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
  const [closing, setClosing] = useState(false);
  const atLimit = atInboxTurnLimit(thread);
  const sendReply = async () => {
    if ((await act("inbox.reply", { body: reply })) !== undefined) setReply("");
  };
  const closeAs = (status: InboxCloseStatus) => act("inbox.close", { status, resolution: line });

  return (
    <footer className="flex flex-col gap-1.5 border-t border-border p-2">
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
      <div className="flex items-end gap-1.5">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={reply.includes("\n") ? 3 : 1}
          maxLength={INBOX_BODY_MAX}
          placeholder="Reply, read when a session opens the thread"
          className={cn(INPUT_CLASS, "min-w-0 flex-1 resize-none")}
        />
        <Button size="sm" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
          Reply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={closing}
          onClick={() => setClosing(!closing)}
        >
          Close
        </Button>
      </div>
      {closing && (
        <div className="flex items-center gap-1.5">
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by the Close button to type the line
            autoFocus
            value={line}
            onChange={(e) => setLine(e.target.value)}
            maxLength={INBOX_RESOLUTION_MAX}
            placeholder="One line on how it ended"
            className={cn(INPUT_CLASS, "min-w-0 flex-1")}
          />
          <Button
            size="sm"
            disabled={busy || !line.trim()}
            onClick={() => void closeAs("resolved")}
          >
            Resolve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !line.trim()}
            onClick={() => void closeAs("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      )}
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
    <div className="flex max-h-full min-h-0 flex-col">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>
      {!closed && (
        <Actions thread={thread} repo={messages[0]?.repo ?? null} homeProject={homeProject} />
      )}
    </div>
  );
}
