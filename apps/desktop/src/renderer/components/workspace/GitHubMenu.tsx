import {
  type AgentCliType,
  type AgentProvider,
  acceptsFollowUps,
  type GitHubCi,
  type GitHubTaskRef,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronLeft, ExternalLink, GitPullRequest } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useDismiss } from "../../hooks/use-dismiss";
import { useLaunchableProviders } from "../../hooks/use-providers";
import { useGitHubOverview } from "../../hooks/use-trpc-github";
import { sessionName } from "../../lib/agent-label";
import { startTaskInNewTab, taskLabel } from "../../lib/github-handoff";
import { openInBrowser } from "../../lib/open-in-browser";
import { isLiveSession } from "../../lib/sidebar-views";
import { trpcMutate } from "../../lib/trpc-client";
import { type AgentState, useProjectAgents } from "../../stores/agents";
import { toastError, useToastStore } from "../../stores/toasts";
import { AgentIcon } from "../common/AgentIcon";

const CI_DOT: Record<GitHubCi, string> = {
  failing: "bg-error",
  pending: "bg-warning",
  passing: "bg-success",
  none: "bg-text-muted/40",
};

const isOpenSession = (a: AgentState) => acceptsFollowUps(a) && isLiveSession(a) && !a.archived;

// A provider that cannot take a prompt at launch would start without the task
const takesTask = (p: AgentProvider) => p.capabilities.supportsPromptArg;

type Menu = "closed" | "list" | GitHubTaskRef;

/** Open PRs and issues of the project, each can go to a session. Hidden without gh or a remote */
export function GitHubMenu() {
  const { projectId } = useProjectContext();
  const { data } = useGitHubOverview(projectId);
  const [menu, setMenu] = useState<Menu>("closed");
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenu("closed"), []);
  useDismiss(rootRef, menu !== "closed", close);

  if (!projectId || !data) return null;
  const failing = data.prs.filter((p) => p.ci === "failing").length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-pressed={menu !== "closed"}
        onClick={() => setMenu(menu === "closed" ? "list" : "closed")}
        title={`${data.prs.length} open PRs, ${data.issues.length} open issues${failing ? `, CI failing on ${failing}` : ""}`}
        className={cn(
          "relative flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium tabular-nums transition-colors hover:bg-white/5 hover:text-text-primary",
          menu !== "closed" ? "bg-white/10 text-text-primary" : "text-text-muted",
        )}
      >
        <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
        {data.prs.length}
        {failing > 0 && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-error" aria-hidden />
        )}
      </button>

      {menu !== "closed" && (
        <div className="absolute top-full right-0 z-50 mt-1 flex max-h-[70vh] w-[26rem] flex-col overflow-y-auto rounded-md border border-border bg-bg-secondary py-1 text-xs shadow-lg">
          {menu !== "list" ? (
            <TargetPicker
              projectId={projectId}
              task={menu}
              onBack={() => setMenu("list")}
              onDone={close}
            />
          ) : (
            <>
              <Heading>Pull requests</Heading>
              {data.prs.length === 0 && <Empty>No open PRs</Empty>}
              {data.prs.map((pr) => (
                <Row
                  key={pr.number}
                  dot={CI_DOT[pr.ci]}
                  number={pr.number}
                  title={pr.title}
                  detail={pr.draft ? `draft, ${pr.branch}` : pr.branch}
                  url={pr.url}
                  onAssign={() => setMenu({ kind: "pr", number: pr.number })}
                  onFixCi={
                    pr.ci === "failing"
                      ? () => setMenu({ kind: "pr", number: pr.number, fixCi: true })
                      : undefined
                  }
                />
              ))}
              <Heading>Issues</Heading>
              {data.issues.length === 0 && <Empty>No open issues</Empty>}
              {data.issues.map((issue) => (
                <Row
                  key={issue.number}
                  number={issue.number}
                  title={issue.title}
                  detail={issue.labels.join(", ")}
                  url={issue.url}
                  onAssign={() => setMenu({ kind: "issue", number: issue.number })}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1 text-text-muted">{children}</p>;
}

function Row({
  dot,
  number,
  title,
  detail,
  url,
  onAssign,
  onFixCi,
}: {
  dot?: string;
  number: number;
  title: string;
  detail: string;
  url: string;
  onAssign: () => void;
  onFixCi?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-1 hover:bg-white/5">
      {dot && <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-text-primary">
          <span className="text-text-muted tabular-nums">#{number}</span> {title}
        </p>
        {detail && <p className="truncate text-[10px] text-text-muted">{detail}</p>}
      </div>
      {onFixCi && (
        <button
          type="button"
          onClick={onFixCi}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-error hover:bg-error/15"
        >
          Fix CI
        </button>
      )}
      <button
        type="button"
        onClick={onAssign}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-white/10 hover:text-text-primary"
      >
        Assign
      </button>
      <button
        type="button"
        onClick={() => openInBrowser(url)}
        title="Open on GitHub"
        aria-label="Open on GitHub"
        className="shrink-0 rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-primary"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

function TargetPicker({
  projectId,
  task,
  onBack,
  onDone,
}: {
  projectId: string;
  task: GitHubTaskRef;
  onBack: () => void;
  onDone: () => void;
}) {
  const sessions = useProjectAgents(projectId, isOpenSession);
  const clis = useLaunchableProviders().filter(takesTask);
  const [busy, setBusy] = useState(false);
  const label = taskLabel(task);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      toastError(`${label}: not sent`)(err);
      setBusy(false);
    }
  };

  const send = (session: AgentState) =>
    run(async () => {
      const { delivered } = await trpcMutate<{ delivered: boolean }>("github.sendTask", {
        projectId,
        agentId: session.id,
        ...task,
      });
      useToastStore.getState().addToast({
        type: "info",
        title: `${label} ${delivered ? "sent to" : "queued for"} ${sessionName(session)}`,
      });
    });

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {label}
      </button>
      <Heading>Open session</Heading>
      {sessions.length === 0 && <Empty>No open sessions here</Empty>}
      {sessions.map((session) => (
        <PickButton
          key={session.id}
          name={sessionName(session)}
          disabled={busy}
          onClick={() => send(session)}
        >
          <AgentIcon provider={session.cliType} size={14} />
        </PickButton>
      ))}
      <Heading>New tab, own worktree</Heading>
      {clis.map((cli) => (
        <PickButton
          key={cli.id}
          name={cli.name}
          disabled={busy}
          onClick={() => run(() => startTaskInNewTab(projectId, cli.id as AgentCliType, task))}
        >
          <AgentIcon provider={cli.id} size={14} fallback={cli.icon} fallbackColor={cli.color} />
        </PickButton>
      ))}
    </>
  );
}

function PickButton({
  name,
  disabled,
  onClick,
  children,
}: {
  name: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1 text-left text-text-primary hover:bg-white/5 disabled:opacity-50"
    >
      {children}
      <span className="truncate">{name}</span>
    </button>
  );
}
