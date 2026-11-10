import type { SpeechFeedback, SpeechFeedbackEntry, SpeechRating } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError } from "../stores/toasts";

const FEEDBACK_KEY = ["commander", "voiceFeedback"];
const NONE: SpeechFeedback[] = [];

/** A session's marks by turn, one query for its whole chat (`commander.voiceFeedback`) */
export function useVoiceFeedback(agentId: string, enabled: boolean) {
  const { data = NONE } = useQuery({
    queryKey: [...FEEDBACK_KEY, agentId],
    queryFn: () => trpcInvoke<SpeechFeedback[]>("commander.voiceFeedback", { agentId }),
    enabled,
  });
  return useMemo(() => new Map(data.map((row) => [row.turnId, row])), [data]);
}

export interface RateInput {
  agentId: string;
  turnId: string;
  text: string;
  rating: SpeechRating;
  note?: string;
}

export function useRateVoice() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: FEEDBACK_KEY });
  const rate = useMutation({
    mutationFn: (input: RateInput) => trpcMutate("commander.rateVoice", input),
    onSuccess: refresh,
    onError: toastError("Could not save the note"),
  });
  const remove = useMutation({
    mutationFn: (turnId: string) => trpcMutate("commander.removeVoiceFeedback", { turnId }),
    onSuccess: refresh,
    onError: toastError("Could not remove the note"),
  });
  return { rate, remove };
}

/** Settings > Models > Voice: every note, newest first */
export function useVoiceFeedbackList() {
  return useQuery({
    queryKey: [...FEEDBACK_KEY, "list"],
    queryFn: () => trpcInvoke<SpeechFeedbackEntry[]>("commander.voiceFeedbackList"),
    // Marks are saved from other windows, and this one gets no focus refetch
    refetchInterval: 5_000,
  });
}
