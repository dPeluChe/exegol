import type { SkillWithState } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useSkills(projectId: string | null, projectPath: string | null) {
  return useQuery({
    queryKey: ["skills", projectId],
    queryFn: () => trpcInvoke<SkillWithState[]>("skills.list", { projectId, projectPath }),
    enabled: !!projectId,
  });
}

export function useToggleSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId: string; skillName: string; enabled: boolean }) =>
      trpcMutate<{ id: string }>("skills.toggle", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useSkillContent(projectPath: string | null, skillName: string | null) {
  return useQuery({
    queryKey: ["skill", "content", skillName],
    queryFn: () => trpcInvoke<string | null>("skills.getContent", { projectPath, skillName }),
    enabled: !!skillName,
  });
}
