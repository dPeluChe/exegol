import type { DictationHistoryItem, DictationStatus } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError } from "../stores/toasts";

const STATUS_KEY = ["dictation", "status"];
const HISTORY_KEY = ["dictation", "history"];

export function useDictationStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => trpcInvoke<DictationStatus>("dictation.status"),
    staleTime: 30_000,
  });
}

export function useDictationHistory(limit = 100) {
  return useQuery({
    queryKey: [...HISTORY_KEY, limit],
    queryFn: () => trpcInvoke<DictationHistoryItem[]>("dictation.history", { limit }),
  });
}

type HistoryAction =
  | { action: "copyHistory" | "insertHistory" | "deleteHistory"; id: string }
  | { action: "clearHistory" };

export function useDictationHistoryAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...input }: HistoryAction) => trpcMutate(`dictation.${action}`, input),
    onError: toastError("Dictation history"),
    onSuccess: (_data, { action }) => {
      if (action === "deleteHistory" || action === "clearHistory") {
        void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      }
    },
  });
}

export function useMicAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "requestMic" | "openMicSettings") => trpcMutate(`dictation.${action}`),
    onError: toastError("Microphone"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}

/** Status bar widget defaults that depend on state: Dictation shows once the mic was allowed */
export function useWidgetDefaults(): { dictation: boolean } {
  const { data } = useDictationStatus();
  return { dictation: data?.micEverGranted ?? false };
}
