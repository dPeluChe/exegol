import type { MemoryEntry } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useMemories(projectId: string | null, category?: string) {
  return useQuery({
    queryKey: ["memory", projectId, category ?? "all"],
    queryFn: () => {
      const input: { projectId: string; category?: string } = { projectId: projectId as string };
      if (category) input.category = category;
      return trpcInvoke<MemoryEntry[]>("memory.list", input);
    },
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export function useSearchMemories(projectId: string | null, query: string) {
  return useQuery({
    queryKey: ["memory", "search", projectId, query],
    queryFn: () => trpcInvoke<MemoryEntry[]>("memory.search", { projectId, query }),
    enabled: !!projectId && query.length > 0,
  });
}

export function useCreateMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      category: string;
      content: string;
      relevanceScore?: number;
    }) => trpcMutate<MemoryEntry>("memory.create", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("memory.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}
