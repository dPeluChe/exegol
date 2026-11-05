import type { GitHubIssue, GitHubOverview } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// main caches it 2 min; null (no gh, no remote, logged out) asks less, it rarely changes
export function useGitHubOverview(projectId: string | null) {
  return useQuery({
    queryKey: ["github-overview", projectId],
    queryFn: () => trpcInvoke<GitHubOverview | null>("github.overview", { projectId }),
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data === null ? 600_000 : 120_000),
  });
}

// ─── GitHub Issues ──────────────────────────────────────────────────────────

export function useGitHubIssues(projectId: string | null) {
  return useQuery({
    queryKey: ["github-issues", projectId],
    queryFn: () => trpcInvoke<GitHubIssue[]>("github.listIssues", { projectId }),
    enabled: !!projectId,
    refetchInterval: 60_000,
  });
}

export function useUpdateIssueState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId: string; issueNumber: number; state: "open" | "closed" }) =>
      trpcMutate<{ success: boolean }>("github.updateIssueState", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["github-issues"] });
    },
  });
}

export function useUpdateIssueLabels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      issueNumber: number;
      addLabels?: string[];
      removeLabels?: string[];
    }) => trpcMutate<{ success: boolean }>("github.updateIssueLabels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["github-issues"] });
    },
  });
}
