import type {
  Activity,
  AgentScoreRow,
  OplogEntry,
  RustFileDiff,
  ScoringStats,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Scoring ────────────────────────────────────────────────────────────────

export function useAgentScore(agentId: string | null) {
  return useQuery({
    queryKey: ["scoring", "agent", agentId],
    queryFn: () => trpcInvoke<AgentScoreRow | null>("scoring.getScore", { agentId }),
    enabled: !!agentId,
  });
}

export function useProjectScores(projectId: string | null) {
  return useQuery({
    queryKey: ["scoring", "project", projectId],
    queryFn: () => trpcInvoke<AgentScoreRow[]>("scoring.listScores", { projectId }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export function useScoringStats(projectId: string | null) {
  return useQuery({
    queryKey: ["scoring", "stats", projectId],
    queryFn: () => trpcInvoke<ScoringStats>("scoring.stats", { projectId }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// ─── Activities (T20) ────────────────────────────────────────────────────────

export function useActivities(projectId: string | null, type?: string) {
  return useQuery({
    queryKey: ["activities", projectId, type],
    queryFn: () =>
      trpcInvoke<Activity[]>("activities.list", {
        projectId: projectId ?? undefined,
        type,
        limit: 100,
      }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export function useDiff(
  projectId: string | null,
  mode: "unstaged" | "staged",
  pathOverride?: string,
) {
  const procedure = mode === "staged" ? "diff.stagedDiff" : "diff.projectDiff";
  return useQuery({
    queryKey: ["diff", pathOverride || projectId, mode],
    queryFn: () => trpcInvoke<string>(procedure, { projectId, pathOverride }),
    enabled: !!projectId,
  });
}

// ─── Review Summary ─────────────────────────────────────────────────────────

export interface ReviewSignal {
  type: "info" | "warn" | "risk";
  label: string;
  detail?: string;
}

export interface ReviewSummary {
  totalFiles: number;
  filesByType: Record<string, number>;
  signals: ReviewSignal[];
  additions: number;
  deletions: number;
}

export function useReviewSummary(
  projectId: string | null,
  pathOverride?: string,
  staged?: boolean,
) {
  return useQuery({
    queryKey: ["diff", "reviewSummary", pathOverride || projectId, staged],
    queryFn: () =>
      trpcInvoke<ReviewSummary>("diff.reviewSummary", { projectId, pathOverride, staged }),
    enabled: !!projectId,
    staleTime: 10_000,
  });
}

export function useStructuredDiff(projectId: string | null, staged: boolean) {
  return useQuery({
    queryKey: ["diff", "structured", projectId, staged],
    queryFn: () => trpcInvoke<RustFileDiff[]>("diff.structuredDiff", { projectId, staged }),
    enabled: !!projectId,
  });
}

// ─── Oplog ──────────────────────────────────────────────────────────────────

export function useProjectOplog(projectId: string | null, limit = 100) {
  return useQuery({
    queryKey: ["oplog", "project", projectId, limit],
    queryFn: () => trpcInvoke<OplogEntry[]>("oplog.listProject", { projectId, limit }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export function useAgentOplog(agentId: string | null) {
  return useQuery({
    queryKey: ["oplog", "agent", agentId],
    queryFn: () => trpcInvoke<OplogEntry[]>("oplog.listAgent", { agentId }),
    enabled: !!agentId,
  });
}

export function useUndoOplog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (oplogId: string) => trpcMutate<OplogEntry>("oplog.undo", { oplogId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oplog"] });
      queryClient.invalidateQueries({ queryKey: ["diff"] });
    },
  });
}
