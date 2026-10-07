import type { ModelListItem, StorageReport } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const MODELS_KEY = ["models", "list"];
const STORAGE_KEY = ["storage", "report"];

/** The catalog with each model's status, kept live by `models:progress` while mounted */
export function useModels() {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api?.onModelProgress?.((event) => {
      queryClient.setQueryData<ModelListItem[]>(MODELS_KEY, (list) =>
        list?.map((m) => (m.id === event.id ? { ...m, status: event.status } : m)),
      );
      if (event.status.state === "ready" || event.status.state === "not_downloaded") {
        void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
      }
    }),
  );
  return useQuery({
    queryKey: MODELS_KEY,
    queryFn: () => trpcInvoke<ModelListItem[]>("models.list"),
  });
}

type ModelAction = "download" | "cancel" | "delete" | "setDefault";

export function useModelAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, id }: { action: ModelAction; id: string }) =>
      trpcMutate(`models.${action}`, { id }),
    onSuccess: (_data, { action }) => {
      if (action !== "download" && action !== "cancel") {
        void queryClient.invalidateQueries({ queryKey: MODELS_KEY });
      }
      if (action === "delete") void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
  });
}

export function useStorageReport() {
  return useQuery({
    queryKey: STORAGE_KEY,
    queryFn: () => trpcInvoke<StorageReport>("storage.report", {}),
    staleTime: 30_000,
  });
}

export function useRefreshStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trpcInvoke<StorageReport>("storage.report", { fresh: true }),
    onSuccess: (report) => queryClient.setQueryData(STORAGE_KEY, report),
  });
}

type StorageAction =
  | { action: "openFolder"; category: string }
  | { action: "clearScreenshots" }
  | { action: "clearOldLogs" }
  | { action: "clearBrowserCache"; projectId: string };

export function useStorageAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...input }: StorageAction) => trpcMutate(`storage.${action}`, input),
    onSuccess: (_data, { action }) => {
      if (action !== "openFolder") void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
  });
}
