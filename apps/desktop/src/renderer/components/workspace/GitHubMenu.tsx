import {
  type AgentCliType,
  type AgentProvider,
  acceptsFollowUps,
  type GitHubCi,
  type GitHubOpenIssue,
  type GitHubOverview,
  type GitHubPr,
  type GitHubTaskRef,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronLeft, ExternalLink, GitPullRequest } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useDismiss } from "../../hooks/use-dismiss";
import { useLaunchableProviders } from "../../hooks/use-providers";
import { useFullGitHubOverview, useGitHubOverview } from "../../hooks/use-trpc-github";
import { sessionName } from "../../lib/agent-label";
import { startTaskInNewTab, taskLabel } from "../../lib/github-handoff";
import {
  groupByRepo,
  reposNotShown,
  sameRepo,
  sessionsInRepoFirst,
  UNAVAILABLE_TEXT,
} from "../../lib/github-repos";
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

/** Open PRs and issues of the project, each can go to a session. Says so when there are none to
 *  ask for: no gh, not logged in, no remote */
export function GitHubMenu() {
  const { projectId } = useProjectContext();
  const { data } = useGitHubOverview(projectId);
  const [menu, setMenu] = useState<Menu>("closed");
  const manyRepos = (data?.repos.length ?? 0) > 1;
  const { isFetching: loadingAll } = useFullGitHubOverview(
    projectId,
    manyRepos && menu !== "closed",
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenu("closed"), []);
  useDismiss(rootRef, menu !== "closed", close);

  if (!projectId || !data) return null;
  if (data.unavailable) {
    const { label, title } = UNAVAILABLE_TEXT[data.unavailable];
    return (
      <span
        title={title}
        className="flex h-7 cursor-default items-center gap-1 rounded px-2 text-[11px] font-medium text-text-muted/60"
      >
        <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  const failing = data.prs.filter((p) => p.ci === "failing").length;
  const repoCount = manyRepos ? ` in ${data.repos.length} repos` : "";
  const { pending } = reposNotShown(data.repos);
  const notChecked = pending > 0 ? `, ${pending} repos not checked yet` : "";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-pressed={menu !== "closed"}
        onClick={() => setMenu(menu === "closed" ? "list" : "closed")}
        title={`${data.prs.length} open PRs, ${data.issues.length} open issues${repoCount}${failing ? `, CI failing on ${failing}` : ""}${notChecked}`}
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
              repoSessions={sessionsOfRepo(data, menu)}
              manyRepos={manyRepos}
              onBack={() => setMenu("list")}
              onDone={close}
            />
          ) : (
            <TaskList overview={data} manyRepos={manyRepos} loading={loadingAll} onPick={setMenu} />
          )}
        </div>
      )}
    </div>
  );
}

function sessionsOfRepo(overview: GitHubOverview, { repo }: GitHubTaskRef): string[] {
  const held = overview.repos.find((r) => sameRepo(r, repo));
  return held?.sessionIds ?? [];
}

function TaskList({
  overview,
  manyRepos,
  loading,
  onPick,
}: {
  overview: GitHubOverview;
  manyRepos: boolean;
  loading: boolean;
  onPick: (task: GitHubTaskRef) => void;
}) {
  if (manyRepos) {
    return <RepoGroups overview={overview} loading={loading} onPick={onPick} />;
  }
  return (
    <>
      <Heading>Pull requests</Heading>
      {overview.prs.length === 0 && <Empty>No open PRs</Empty>}
      <PrRows prs={overview.prs} onPick={onPick} />
      <Heading>Issues</Heading>
      {overview.issues.length === 0 && <Empty>No open issues</Empty>}
      <IssueRows issues={overview.issues} onPick={onPick} />
    </>
  );
}

function RepoGroups({
  overview,
  loading,
  onPick,
}: {
  overview: GitHubOverview;
  loading: boolean;
  onPick: (task: GitHubTaskRef) => void;
}) {
  const [filter, setFilter] = useState("");
  const groups = groupByRepo(overview, filter);
  const { failed, pending } = reposNotShown(overview.repos);
  return (
    <>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by repo or title"
        aria-label="Filter by repo or title"
        className="mx-2 mt-1 mb-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
      />
      {groups.length === 0 && !loading && <Empty>No open PRs or issues</Empty>}
      {groups.map(({ repo, prs, issues }) => (
        <div key={`${repo.name}:${repo.folder}`}>
          <Heading>
            {repo.folder || repo.name}
            <span className="ml-1.5 normal-case tracking-normal opacity-70">{repo.name}</span>
          </Heading>
          <PrRows prs={prs} onPick={onPick} />
          <IssueRows issues={issues} onPick={onPick} issuePrefix />
        </div>
      ))}
      {loading && pending > 0 && <Empty>Checking {pending} more repos</Empty>}
      {failed.length > 0 && (
        <Empty>Could not load: {failed.map((r) => r.folder || r.name).join(", ")}</Empty>
      )}
    </>
  );
}

function PrRows({ prs, onPick }: { prs: GitHubPr[]; onPick: (task: GitHubTaskRef) => void }) {
  return prs.map((pr) => {
    const task = { kind: "pr", number: pr.number, repo: pr.repo } as const;
    return (
      <Row
        key={pr.url}
        dot={CI_DOT[pr.ci]}
        number={pr.number}
        title={pr.title}
        detail={pr.draft ? `draft, ${pr.branch}` : pr.branch}
        url={pr.url}
        onAssign={() => onPick(task)}
        onFixCi={pr.ci === "failing" ? () => onPick({ ...task, fixCi: true }) : undefined}
      />
    );
  });
}

function IssueRows({
  issues,
  onPick,
  issuePrefix,
}: {
  issues: GitHubOpenIssue[];
  onPick: (task: GitHubTaskRef) => void;
  issuePrefix?: boolean;
}) {
  return issues.map((issue) => (
    <Row
      key={issue.url}
      number={issue.number}
      title={issue.title}
      detail={[...(issuePrefix ? ["Issue"] : []), ...issue.labels].join(", ")}
      url={issue.url}
      onAssign={() => onPick({ kind: "issue", number: issue.number, repo: issue.repo })}
    />
  ));
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
  repoSessions,
  manyRepos,
  onBack,
  onDone,
}: {
  projectId: string;
  task: GitHubTaskRef;
  repoSessions: string[];
  manyRepos: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const sessions = sessionsInRepoFirst(useProjectAgents(projectId, isOpenSession), repoSessions);
  const clis = useLaunchableProviders().filter(takesTask);
  const [busy, setBusy] = useState(false);
  const label = taskLabel(task);
  const repoName = task.repo.folder || task.repo.name;

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
          hint={manyRepos && !repoSessions.includes(session.id) ? "elsewhere" : undefined}
          disabled={busy}
          onClick={() => send(session)}
        >
          <AgentIcon provider={session.cliType} size={14} />
        </PickButton>
      ))}
      <Heading>
        {manyRepos ? `New tab in ${repoName}, own worktree` : "New tab, own worktree"}
      </Heading>
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
  hint,
  disabled,
  onClick,
  children,
}: {
  name: string;
  hint?: string;
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
      {hint && <span className="ml-auto shrink-0 text-[10px] text-text-muted">{hint}</span>}
    </button>
  );
}
