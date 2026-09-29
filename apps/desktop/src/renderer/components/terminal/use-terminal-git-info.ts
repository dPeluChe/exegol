import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../../lib/trpc-client";

/** Branch (the agent's own, else the repo's current one), dirty file count and web URL for a terminal's toolbar */
export function useTerminalGitInfo(
  projectId: string | undefined,
  branchName: string | null | undefined,
) {
  // T155 (verify session): repo-root agents have no worktree branch — show the
  // repo's current branch + dirty count instead. Query keys shared with
  // GitPane, so this costs zero extra polling.
  const { data: repoBranch } = useQuery({
    queryKey: ["git", "branch", projectId],
    queryFn: () => trpcInvoke<string>("diff.branch", { projectId }),
    enabled: !!projectId && !branchName,
    staleTime: 30_000,
  });
  const { data: gitStatusFiles } = useQuery({
    queryKey: ["git", "status", projectId],
    queryFn: () => trpcInvoke<Array<{ path: string }>>("diff.status", { projectId }),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
  const { data: repoUrl } = useQuery({
    queryKey: ["git", "remoteWebUrl", projectId],
    queryFn: () => trpcInvoke<string | null>("diff.remoteWebUrl", { projectId }),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
  return {
    branchName: branchName ?? repoBranch ?? null,
    dirtyCount: gitStatusFiles?.length ?? 0,
    repoUrl,
  };
}
