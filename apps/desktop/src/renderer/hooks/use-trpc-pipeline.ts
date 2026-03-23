import type {
  PipelineRun,
  PipelineRunCreate,
  PipelineTemplate,
  PipelineTemplateCreate,
  PipelineTemplateUpdate,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Templates ──────────────────────────────────────────────────────────────

export function usePipelineTemplates(projectId: string | null) {
  return useQuery({
    queryKey: ["pipeline", "templates", projectId],
    queryFn: () => trpcInvoke<PipelineTemplate[]>("pipeline.listTemplates", { projectId }),
    enabled: !!projectId,
  });
}

export function usePipelineTemplate(id: string | null) {
  return useQuery({
    queryKey: ["pipeline", "template", id],
    queryFn: () => trpcInvoke<PipelineTemplate>("pipeline.getTemplate", { id }),
    enabled: !!id,
  });
}

export function useCreatePipelineTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PipelineTemplateCreate) =>
      trpcMutate<PipelineTemplate>("pipeline.createTemplate", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "templates"] });
    },
  });
}

export function useUpdatePipelineTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string } & PipelineTemplateUpdate) =>
      trpcMutate<PipelineTemplate>("pipeline.updateTemplate", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "templates"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "template"] });
    },
  });
}

export function useDeletePipelineTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("pipeline.deleteTemplate", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "templates"] });
    },
  });
}

// ─── Runs ───────────────────────────────────────────────────────────────────

export function usePipelineRuns(projectId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["pipeline", "runs", projectId],
    queryFn: () => trpcInvoke<PipelineRun[]>("pipeline.listRuns", { projectId }),
    enabled: !!projectId,
    refetchInterval: 30_000, // Fallback only — push events handle real-time updates
  });

  // Subscribe to push events for real-time updates
  useEffect(() => {
    if (!window.api.onPipelineStatus) return;
    const unsubscribe = window.api.onPipelineStatus(() => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}

export function usePipelineRun(id: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["pipeline", "run", id],
    queryFn: () => trpcInvoke<PipelineRun>("pipeline.getRun", { id }),
    enabled: !!id,
    refetchInterval: 30_000, // Fallback only — push events handle real-time updates
  });

  useEffect(() => {
    if (!window.api.onPipelineStatus) return;
    const unsubscribe = window.api.onPipelineStatus((event) => {
      if ((event as { runId: string }).runId === id) {
        queryClient.invalidateQueries({ queryKey: ["pipeline", "run", id] });
      }
    });
    return unsubscribe;
  }, [queryClient, id]);

  return query;
}

export function useStartPipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PipelineRunCreate) => trpcMutate<PipelineRun>("pipeline.startRun", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    },
  });
}

export function usePausePipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("pipeline.pauseRun", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "run"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    },
  });
}

export function useResumePipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("pipeline.resumeRun", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "run"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    },
  });
}

export function useCancelPipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("pipeline.cancelRun", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "run"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    },
  });
}

export function useDeletePipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("pipeline.deleteRun", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "runs"] });
    },
  });
}
