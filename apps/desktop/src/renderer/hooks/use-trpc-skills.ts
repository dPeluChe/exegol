import type {
  ImportCandidate,
  SkillInstallResult,
  SkillLockFile,
  SkillRegistryEntry,
  SkillWithState,
} from "@exegol/shared";
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

// ─── Skill installer hooks ──────────────────────────────────────────────────

export function useSkillRegistry() {
  return useQuery({
    queryKey: ["skillInstaller", "registry"],
    queryFn: () => trpcInvoke<SkillRegistryEntry[]>("skillInstaller.registry"),
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { repo: string; scope: "global" | "project"; projectPath?: string }) =>
      trpcMutate<SkillInstallResult>("skillInstaller.install", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skillInstaller"] });
    },
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { skillName: string; scope: "global" | "project"; projectPath?: string }) =>
      trpcMutate<boolean>("skillInstaller.uninstall", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skillInstaller"] });
    },
  });
}

export function useScanImports() {
  return useQuery({
    queryKey: ["skillInstaller", "scanImports"],
    queryFn: () => trpcInvoke<ImportCandidate[]>("skillInstaller.scanImports"),
    enabled: false, // Manual trigger only
  });
}

export function useImportSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      skills: Array<{ agent: string; sourcePath: string; name: string }>;
      force?: boolean;
    }) => trpcMutate<SkillInstallResult>("skillInstaller.importSelected", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skillInstaller"] });
    },
  });
}

export function useSkillLockFile(scope: "global" | "project", projectPath?: string) {
  return useQuery({
    queryKey: ["skillInstaller", "lockFile", scope, projectPath],
    queryFn: () => trpcInvoke<SkillLockFile>("skillInstaller.lockFile", { scope, projectPath }),
  });
}
