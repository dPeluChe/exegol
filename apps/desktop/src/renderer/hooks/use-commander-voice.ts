import type { CommanderVoiceSettings, VoiceSpeaker } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";

interface CommanderVoice {
  settings: CommanderVoiceSettings;
  voices: VoiceSpeaker[];
  /** A voice model is installed */
  ready: boolean;
}

export const VOICE_KEY = ["commander", "voice"];

/** How the Commander's replies are read aloud (`commander.voice`) */
export function useCommanderVoice(enabled = true) {
  return useQuery({
    queryKey: VOICE_KEY,
    queryFn: () => trpcInvoke<CommanderVoice>("commander.voice"),
    enabled,
  });
}
