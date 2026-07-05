import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export interface KnowledgeSnapshot {
  brief: string;
  digest: string;
  digestRefreshedOnLoad: boolean;
  digestStale: boolean;
  memoryBridgeExists: boolean;
}

export function useKnowledge(projectId: string | null) {
  return useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: () => trpcInvoke<KnowledgeSnapshot>("knowledge.get", { projectId }),
    enabled: !!projectId,
  });
}

export function useSaveBrief(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      trpcMutate<{ success: boolean }>("knowledge.saveBrief", { projectId, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
    },
  });
}

export function useRefreshDigest(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trpcMutate<{ digest: string }>("knowledge.refreshDigest", { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
    },
  });
}

export function useSyncMemoryBridge(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      trpcMutate<{ content: string }>("knowledge.syncMemoryBridge", { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
    },
  });
}

export function useImportMemoryBridgeAsSeed(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      trpcMutate<{ imported: number }>("knowledge.importMemoryBridgeAsSeed", { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}
