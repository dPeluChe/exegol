import type {
  Activity,
  AgentScoreRow,
  LatestTurn,
  OplogEntry,
  OplogSnapshot,
  ScoringStats,
  TurnChanges,
  UndoTurnResult,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError, useToastStore } from "../stores/toasts";

// ─── Scoring ────────────────────────────────────────────────────────────────

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
  refetchIntervalMs?: number,
) {
  const procedure = mode === "staged" ? "diff.stagedDiff" : "diff.projectDiff";
  return useQuery({
    queryKey: ["diff", pathOverride || projectId, mode],
    queryFn: () => trpcInvoke<string>(procedure, { projectId, pathOverride }),
    enabled: !!projectId,
    refetchInterval: refetchIntervalMs ?? false,
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

// ─── Oplog ──────────────────────────────────────────────────────────────────

export function useProjectOplog(projectId: string | null, limit = 100) {
  return useQuery({
    queryKey: ["oplog", "project", projectId, limit],
    queryFn: () => trpcInvoke<OplogEntry[]>("oplog.listProject", { projectId, limit }),
    enabled: !!projectId,
    refetchInterval: 30_000,
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
    onError: toastError("Undo failed"),
  });
}

// ─── Oplog v2 (T129) — hidden-ref turn snapshots ───────────────────────────

export function useOplogSnapshots(projectId: string | null, limit = 200) {
  return useQuery({
    queryKey: ["oplog", "snapshots", projectId, limit],
    queryFn: () => trpcInvoke<OplogSnapshot[]>("oplog.listSnapshots", { projectId, limit }),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useRestoreOplogSnapshot(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sha: string) => trpcMutate<string>("oplog.restoreSnapshot", { projectId, sha }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oplog"] });
      queryClient.invalidateQueries({ queryKey: ["diff"] });
    },
    onError: toastError("Restore failed"),
  });
}

// ─── T200.5: changes of an agent's last turn ───────────────────────────────

/** Refreshed by the `agent:turn-changes` push (stores/agents.ts) */
export function useLatestTurn(agentId: string) {
  return useQuery({
    queryKey: ["oplog", "turn", agentId],
    queryFn: () => trpcInvoke<LatestTurn>("oplog.latestTurn", { agentId }),
  });
}

export function useTurnDiff(turn: TurnChanges | null) {
  return useQuery({
    queryKey: ["oplog", "turn-diff", turn?.agentId, turn?.turnIndex],
    queryFn: () =>
      trpcInvoke<string>("oplog.turnDiff", { agentId: turn?.agentId, turnIndex: turn?.turnIndex }),
    enabled: !!turn,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useUndoTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (turn: TurnChanges) =>
      trpcMutate<UndoTurnResult>("oplog.undoTurn", {
        agentId: turn.agentId,
        turnIndex: turn.turnIndex,
      }),
    onSuccess: ({ restored, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["oplog"] });
      queryClient.invalidateQueries({ queryKey: ["diff"] });
      if (skipped.length === 0) return;
      useToastStore.getState().addToast({
        type: "warning",
        title:
          restored.length === 0
            ? "Nothing undone: every file changed since the turn"
            : `Undid ${restored.length} of ${restored.length + skipped.length} files`,
        body: `Changed since the turn, left as they are: ${skipped.join(", ")}`,
      });
    },
    onError: toastError("Undo turn failed"),
  });
}
