import type { ProjectGroup, ProjectGroupCreate } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useProjectGroups() {
  return useQuery({
    queryKey: ["projectGroups"],
    queryFn: () => trpcInvoke<ProjectGroup[]>("projectGroups.list"),
  });
}

export function useCreateProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectGroupCreate) =>
      trpcMutate<ProjectGroup>("projectGroups.create", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectGroups"] }),
  });
}

export function useRenameProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      trpcMutate<{ success: boolean }>("projectGroups.rename", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectGroups"] }),
  });
}

export function useSetProjectGroupAppearance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      color: string | null;
      icon: string | null;
      background: string | null;
    }) => trpcMutate<{ success: boolean }>("projectGroups.setAppearance", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectGroups"] }),
  });
}

export function useSetProjectGroupCollapsed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; collapsed: boolean }) =>
      trpcMutate<{ success: boolean }>("projectGroups.setCollapsed", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectGroups"] }),
  });
}

export function useReorderProjectGroups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      trpcMutate<{ success: boolean }>("projectGroups.reorder", { orderedIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectGroups"] }),
  });
}

/** Disband: deletes the group, member projects fall back to root. */
export function useDeleteProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("projectGroups.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projectGroups"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** Move a project into a group (or ungroup with groupId: null). */
export function useSetProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; groupId: string | null }) =>
      trpcMutate<{ success: boolean }>("projects.setGroup", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}
