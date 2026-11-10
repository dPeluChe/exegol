import type { SpeechFeedback, SpeechFeedbackEntry, SpeechRating } from "@exegol/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { toastError } from "../stores/toasts";

const FEEDBACK_KEY = ["commander", "voiceFeedback"];
const MAX_TURNS = 200;

/** The marks on these turns, one query for a whole chat (`commander.voiceFeedback`) */
export function useVoiceFeedback(turnIds: string[], enabled: boolean) {
  const ids = turnIds.slice(-MAX_TURNS);
  const query = useQuery({
    queryKey: [...FEEDBACK_KEY, ids],
    queryFn: () => trpcInvoke<SpeechFeedback[]>("commander.voiceFeedback", { turnIds: ids }),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const byTurn = new Map<string, SpeechFeedback>();
  for (const row of query.data ?? []) byTurn.set(row.turnId, row);
  return byTurn;
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
    refetchOnWindowFocus: true,
  });
}
