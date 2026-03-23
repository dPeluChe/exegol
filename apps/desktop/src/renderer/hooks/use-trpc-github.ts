import type { GitHubIssue } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

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
