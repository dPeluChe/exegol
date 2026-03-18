import type { SearchResult } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Search ─────────────────────────────────────────────────────────────

export type { SearchResult };

export function useSearch(query: string, projectId?: string | null) {
  return useQuery({
    queryKey: ["search", query, projectId],
    queryFn: () =>
      trpcInvoke<SearchResult[]>("search.query", {
        query,
        projectId: projectId ?? undefined,
      }),
    enabled: query.length > 0,
  });
}

export function useIndexAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { agentId: string; projectId: string; taskDescription: string }) =>
      trpcMutate<{ indexed: number }>("search.indexAgent", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

export function useRebuildSearchIndex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trpcMutate<{ indexed: number }>("search.rebuild"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}
