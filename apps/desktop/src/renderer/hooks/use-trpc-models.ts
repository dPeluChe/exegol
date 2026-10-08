import type { ModelListItem, StorageCategory, StorageReport, StorageRoot } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError } from "../stores/toasts";
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
    mutationFn: ({
      action,
      ...input
    }: {
      action: ModelAction;
      id: string;
      acceptNonCommercial?: boolean;
    }) => trpcMutate(`models.${action}`, input),
    onError: toastError("Model action failed"),
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
    onError: toastError("Could not measure disk use"),
  });
}

type StorageAction =
  | { action: "openFolder"; category: StorageCategory }
  | { action: "openOther"; root: StorageRoot; name: string }
  | { action: "clearScreenshots" }
  | { action: "clearOldLogs" }
  | { action: "clearBrowserCache"; projectId: string };

export function useStorageAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...input }: StorageAction) => trpcMutate(`storage.${action}`, input),
    onError: toastError("Storage action failed"),
    onSuccess: (_data, { action }) => {
      if (action !== "openFolder" && action !== "openOther")
        void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
  });
}

/** Per worktree id; du over whole checkouts, so only while the Worktrees tab shows */
export function useWorktreeSizes() {
  return useQuery({
    queryKey: ["storage", "worktreeSizes"],
    queryFn: () => trpcInvoke<Record<string, number | null>>("storage.worktreeSizes"),
    staleTime: 30_000,
  });
}
