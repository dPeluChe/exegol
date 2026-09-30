import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Ports ──────────────────────────────────────────────────────────────────

export interface PortInfo {
  port: number;
  source: "runtime" | "config";
  pid?: number;
  process?: string;
  file?: string;
}

export function useProjectPorts(projectPath: string | null) {
  return useQuery({
    queryKey: ["resources", "ports", projectPath],
    queryFn: () => trpcInvoke<PortInfo[]>("resources.ports", { projectPath }),
    enabled: !!projectPath,
    // A stopped server kept its green chip for up to 30s
    refetchInterval: 10_000,
  });
}

export function usePreferredPort(projectId: string | null) {
  return useQuery({
    queryKey: ["resources", "preferredPort", projectId],
    queryFn: () => trpcInvoke<number | null>("resources.preferredPort", { projectId }),
    enabled: !!projectId,
  });
}

export function useSetPreferredPort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; port: number }) =>
      trpcMutate<number>("resources.setPreferredPort", input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["resources", "preferredPort", vars.projectId] });
    },
  });
}

// ─── Scripts ───────────────────────────────────────────────────────────────

export interface DetectedScript {
  name: string;
  command: string;
  source: string;
  framework?: string;
}
