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
    onSuccess: (comment) => {
      queryClient.invalidateQueries({
        queryKey: ["diffComments", comment.projectId],
      });
    },
  });
}

export function useDeleteDiffComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("diffComments.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diffComments"] });
    },
  });
}

export function useToggleResolveDiffComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      trpcMutate<{ success: boolean }>("diffComments.toggleResolve", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diffComments"] });
    },
  });
}
