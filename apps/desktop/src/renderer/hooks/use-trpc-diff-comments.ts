import type { DiffComment, DiffCommentCreate } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useDiffComments(projectId: string | null, filePath?: string) {
  return useQuery({
    queryKey: ["diffComments", projectId, filePath],
    queryFn: () =>
      trpcInvoke<DiffComment[]>("diffComments.list", {
        projectId: projectId as string,
        filePath,
      }),
    enabled: !!projectId,
  });
}

export function useAddDiffComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DiffCommentCreate) => trpcMutate<DiffComment>("diffComments.add", data),
    onMutate: async (data) => {
      // Optimistic update: insert a placeholder comment immediately
      const queryKey = ["diffComments", data.projectId, data.filePath];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DiffComment[]>(queryKey);
      const optimistic: DiffComment = {
        id: `optimistic-${Date.now()}`,
        projectId: data.projectId,
        agentId: data.agentId ?? null,
        filePath: data.filePath,
        lineNumber: data.lineNumber,
        hunkIndex: data.hunkIndex ?? null,
        content: data.content,
        resolved: false,
        createdAt: Math.floor(Date.now() / 1000),
      };
      queryClient.setQueryData<DiffComment[]>(queryKey, (old) => [...(old ?? []), optimistic]);
      return { previous, queryKey };
    },
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["diffComments", variables.projectId, variables.filePath],
      });
    },
  });
}

export function useDeleteDiffComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("diffComments.delete", { id }),
    onMutate: async (id) => {
      // Optimistic: remove from all matching queries
      const queries = queryClient.getQueriesData<DiffComment[]>({
        queryKey: ["diffComments"],
      });
      const snapshots: { queryKey: readonly unknown[]; data: DiffComment[] | undefined }[] = [];
      for (const [queryKey, data] of queries) {
        if (data) {
          snapshots.push({ queryKey, data });
          queryClient.setQueryData<DiffComment[]>(
            queryKey,
            data.filter((c) => c.id !== id),
          );
        }
      }
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      for (const { queryKey, data } of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["diffComments"] });
    },
  });
}

export function useToggleResolveDiffComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      trpcMutate<{ success: boolean }>("diffComments.toggleResolve", { id }),
    onMutate: async (id) => {
      // Optimistic: toggle resolved state in all matching queries
      const queries = queryClient.getQueriesData<DiffComment[]>({
        queryKey: ["diffComments"],
      });
      const snapshots: { queryKey: readonly unknown[]; data: DiffComment[] | undefined }[] = [];
      for (const [queryKey, data] of queries) {
        if (data) {
          snapshots.push({ queryKey, data });
          queryClient.setQueryData<DiffComment[]>(
            queryKey,
            data.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)),
          );
        }
      }
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      for (const { queryKey, data } of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["diffComments"] });
    },
  });
}
