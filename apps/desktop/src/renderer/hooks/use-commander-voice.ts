import type { CommanderVoiceSettings, VoiceSpeaker } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

interface CommanderVoice {
  settings: CommanderVoiceSettings;
  voices: VoiceSpeaker[];
  /** A voice model is installed */
  ready: boolean;
}

export const VOICE_KEY = ["commander", "voice"];

/** How the Commander's replies are read aloud (`commander.voice`) */
export function useCommanderVoice(enabled = true) {
  const queryClient = useQueryClient();
  // A voice downloaded or deleted in the Settings window
  useMountEffect(() =>
    enabled
      ? window.api?.onModelProgress?.((event) => {
          if (event.status.state === "ready" || event.status.state === "not_downloaded")
            void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
        })
      : undefined,
  );
  return useQuery({
    queryKey: VOICE_KEY,
    queryFn: () => trpcInvoke<CommanderVoice>("commander.voice"),
    enabled,
    // A change made in the other chat window
    refetchOnWindowFocus: true,
  });
}
