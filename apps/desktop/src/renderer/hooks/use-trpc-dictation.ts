import type { DictationHistoryItem, DictationStatus } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError, useToastStore } from "../stores/toasts";
import { useMountEffect } from "./use-mount-effect";

/** One source for mic, model and engine status: the controller writes here after each start */
export const DICTATION_STATUS_KEY = ["dictation", "status"];
const HISTORY_KEY = ["dictation", "history"];

export const fetchDictationStatus = () => trpcInvoke<DictationStatus>("dictation.status");

export function useDictationStatus() {
  return useQuery({
    queryKey: DICTATION_STATUS_KEY,
    queryFn: fetchDictationStatus,
    staleTime: 30_000,
  });
}

/** Kept fresh by `dictation:done` (a dictation saved, or retention pruned) */
export function useDictationHistory(limit = 100) {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api.dictation.onDone(() => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    }),
  );
  return useQuery({
    queryKey: [...HISTORY_KEY, limit],
    queryFn: () => trpcInvoke<DictationHistoryItem[]>("dictation.history", { limit }),
  });
}

type HistoryAction =
  | { action: "copyHistory" | "deleteHistory"; id: string }
  | { action: "clearHistory" };

export function useDictationHistoryAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...input }: HistoryAction) => trpcMutate(`dictation.${action}`, input),
    onError: toastError("Dictation history"),
    onSuccess: (_data, { action }) => {
      if (action === "copyHistory") {
        useToastStore
          .getState()
          .addToast({ type: "info", title: "Copied", body: "Paste it where you need it" });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
  });
}

export function useMicAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "requestMic" | "openMicSettings") => trpcMutate(`dictation.${action}`),
    onError: toastError("Microphone"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: DICTATION_STATUS_KEY }),
  });
}

/** macOS asks for Automation over Music and Spotify now (only those running) */
export function useMediaConsent() {
  return useMutation({
    mutationFn: () => trpcMutate<{ asked: number }>("dictation.mediaConsent"),
    onError: toastError("Music control"),
  });
}

/** The speech engine loads on this system: without it every dictation control hides */
export function useDictationAvailable(): boolean {
  const { data } = useDictationStatus();
  return data?.engineAvailable === true;
}

/** Status bar widget defaults that depend on state: Dictation shows once the mic was allowed */
export function useWidgetDefaults(): { dictation: boolean } {
  const { data } = useDictationStatus();
  return { dictation: data?.micEverGranted ?? false };
}
