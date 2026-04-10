import { Button } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Merge,
  Upload,
} from "lucide-react";
import { useCallback } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useToastStore } from "../../stores/toasts";

function toast(type: "success" | "error", title: string, body?: string) {
  useToastStore.getState().addToast({ type, title, body });
}

interface GitState {
  branch: string;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  dirtyStaged: number;
  dirtyUnstaged: number;
  conflicts: number;
  pr: {
    state: "none" | "open" | "merged" | "closed";
    url?: string;
    mergeable?: boolean;
    mergeStateStatus?: string;
  };
  ghInstalled: boolean;
}

interface SmartGitActionProps {
  projectId: string;
  overridePath?: string;
  /** Whether the commit message input has non-empty content */
  hasCommitMessage: boolean;
  /** Called when the user wants to execute "commit" — parent owns the commit mutation */
  onCommit: () => void;
  /** Whether the parent's commit mutation is running */
  isCommitting: boolean;
}

type ActionKind =
  | "loading"
  | "clean"
  | "conflicts"
  | "commit"
  | "commit-disabled"
  | "push"
  | "create-pr"
  | "merge-pr"
  | "view-pr"
  | "install-gh"
  | "pr-closed";

interface ActionConfig {
  kind: ActionKind;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: "primary" | "warn" | "success" | "muted";
  disabled?: boolean;
}

function computeNextAction(
  state: GitState | undefined,
  isLoading: boolean,
  hasCommitMessage: boolean,
): ActionConfig {
  if (isLoading || !state) {
    return {
      kind: "loading",
      label: "…",
      hint: "Loading git state",
      icon: Loader2,
      variant: "muted",
    };
  }
  if (state.conflicts > 0) {
    return {
      kind: "conflicts",
      label: "Resolve Conflicts",
      hint: `${state.conflicts} file(s) have merge conflicts — resolve them first`,
      icon: AlertTriangle,
      variant: "warn",
      disabled: true,
    };
  }
  const dirty = state.dirtyStaged + state.dirtyUnstaged;
  if (dirty > 0) {
    if (!hasCommitMessage) {
      return {
        kind: "commit-disabled",
        label: `Commit ${dirty} file${dirty === 1 ? "" : "s"}`,
        hint: "Write a commit message first",
        icon: Check,
        variant: "primary",
        disabled: true,
      };
    }
    return {
      kind: "commit",
      label: `Commit ${dirty} file${dirty === 1 ? "" : "s"}`,
      hint: state.dirtyStaged > 0 ? "Commit staged changes" : "Stage all + commit",
      icon: Check,
      variant: "primary",
    };
  }
  // Clean working tree
  if (state.ahead > 0 || !state.hasUpstream) {
    return {
      kind: "push",
      label: state.hasUpstream ? `Push ${state.ahead}` : "Push New Branch",
      hint: state.hasUpstream
        ? `${state.ahead} unpushed commit(s)`
        : "Set upstream and push this branch",
      icon: Upload,
      variant: "primary",
    };
  }
  // Up to date with remote
  if (state.pr.state === "open") {
    if (state.pr.mergeable) {
      return {
        kind: "merge-pr",
        label: "Merge PR",
        hint: "Squash and merge the open PR",
        icon: Merge,
        variant: "success",
      };
    }
    return {
      kind: "view-pr",
      label: "View PR",
      hint: `PR is not mergeable (${state.pr.mergeStateStatus ?? "unknown"})`,
      icon: ExternalLink,
      variant: "warn",
    };
  }
  if (state.pr.state === "merged") {
    return {
      kind: "pr-closed",
      label: "PR Merged",
      hint: "This branch has already been merged",
      icon: CheckCheck,
      variant: "muted",
      disabled: true,
    };
  }
  if (state.pr.state === "closed") {
    return {
      kind: "pr-closed",
      label: "PR Closed",
      hint: "The PR for this branch was closed without merging",
      icon: CheckCheck,
      variant: "muted",
      disabled: true,
    };
  }
  // No PR yet
  if (!state.ghInstalled) {
    return {
      kind: "install-gh",
      label: "Install gh CLI",
      hint: "Install GitHub CLI from cli.github.com to create PRs from Exegol",
      icon: ExternalLink,
      variant: "muted",
    };
  }
  return {
    kind: "create-pr",
    label: "Create PR",
    hint: "Open a pull request on GitHub",
    icon: GitPullRequest,
    variant: "primary",
  };
}

export function SmartGitAction({
  projectId,
  overridePath,
  hasCommitMessage,
  onCommit,
  isCommitting,
}: SmartGitActionProps) {
  const queryClient = useQueryClient();

  const { data: state, isLoading } = useQuery({
    queryKey: ["git", "state", overridePath || projectId],
    queryFn: () => trpcInvoke<GitState>("diff.gitState", { projectId, pathOverride: overridePath }),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["git"] });
  }, [queryClient]);

  const pushMutation = useMutation({
    mutationFn: () =>
      trpcMutate<{ output: string }>("diff.push", { projectId, pathOverride: overridePath }),
    onSuccess: (r) => {
      toast("success", "Pushed", r.output || "Branch pushed to remote");
      invalidate();
    },
    onError: (err) => {
      toast("error", "Push failed", err instanceof Error ? err.message : String(err));
    },
  });

  const createPrMutation = useMutation({
    mutationFn: () =>
      trpcMutate<{ url: string }>("diff.createPullRequest", {
        projectId,
        pathOverride: overridePath,
      }),
    onSuccess: (r) => {
      toast("success", "PR created", r.url);
      invalidate();
    },
    onError: (err) => {
      toast("error", "Create PR failed", err instanceof Error ? err.message : String(err));
    },
  });

  const mergePrMutation = useMutation({
    mutationFn: () =>
      trpcMutate<{ output: string }>("diff.mergePullRequest", {
        projectId,
        pathOverride: overridePath,
        strategy: "squash",
        deleteBranch: true,
      }),
    onSuccess: (r) => {
      toast("success", "PR merged", r.output);
      invalidate();
    },
    onError: (err) => {
      toast("error", "Merge failed", err instanceof Error ? err.message : String(err));
    },
  });

  const action = computeNextAction(state, isLoading, hasCommitMessage);
  const isRunning =
    isCommitting ||
    pushMutation.isPending ||
    createPrMutation.isPending ||
    mergePrMutation.isPending;

  const handleClick = useCallback(() => {
    switch (action.kind) {
      case "commit":
        onCommit();
        break;
      case "push":
        pushMutation.mutate();
        break;
      case "create-pr":
        createPrMutation.mutate();
        break;
      case "merge-pr":
        mergePrMutation.mutate();
        break;
      case "view-pr":
        if (state?.pr.url) window.open(state.pr.url, "_blank");
        break;
      case "install-gh":
        window.open("https://cli.github.com/", "_blank");
        break;
      case "conflicts":
      case "commit-disabled":
      case "clean":
      case "pr-closed":
      case "loading":
        // No-op
        break;
    }
  }, [action.kind, onCommit, pushMutation, createPrMutation, mergePrMutation, state]);

  const Icon = action.icon;
  const variantClass =
    action.variant === "primary"
      ? "bg-accent text-white hover:bg-accent/90"
      : action.variant === "success"
        ? "bg-success text-white hover:bg-success/90"
        : action.variant === "warn"
          ? "bg-warning/20 text-warning hover:bg-warning/30"
          : "bg-bg-tertiary text-text-secondary hover:text-text-primary";

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={action.disabled || isRunning}
      className={`h-7 gap-1 px-2.5 text-[10px] ${variantClass}`}
      title={action.hint}
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className={`h-3 w-3 ${action.kind === "loading" ? "animate-spin" : ""}`} />
      )}
      {action.label}
    </Button>
  );
}
