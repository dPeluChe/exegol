import type { GitHubIssue, GitHubOverview } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

const overviewKey = (projectId: string | null) => ["github-overview", projectId];

// main caches it under 2 min and picks which repos to ask; `unavailable` asks less, it rarely changes
export function useGitHubOverview(projectId: string | null) {
  return useQuery({
    queryKey: overviewKey(projectId),
    queryFn: () => trpcInvoke<GitHubOverview>("github.overview", { projectId }),
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data?.unavailable ? 600_000 : 120_000),
  });
}

/** Every repo of the project, once per menu open; the answer feeds the sidebar and the bar */
export function useFullGitHubOverview(projectId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["github-overview-full", projectId],
    queryFn: async () => {
      const full = await trpcInvoke<GitHubOverview>("github.overview", { projectId, full: true });
      queryClient.setQueryData(overviewKey(projectId), full);
      return full;
    },
    enabled: enabled && !!projectId,
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
