import type { CommanderVoiceSettings, VoiceSpeaker } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Square, Volume2 } from "lucide-react";
import { speakReply, stopSpeaking, useSpeaking } from "../../../lib/speech/player";
import { trpcInvoke } from "../../../lib/trpc-client";

export interface CommanderVoice {
  settings: CommanderVoiceSettings;
  voices: VoiceSpeaker[];
  /** A voice model is installed */
  ready: boolean;
}

export const VOICE_KEY = ["commander", "voice"];

export function useCommanderVoice(enabled = true) {
  return useQuery({
    queryKey: VOICE_KEY,
    queryFn: () => trpcInvoke<CommanderVoice>("commander.voice"),
    enabled,
  });
}

/** Reads one reply aloud; while it plays, stops it */
export function SpeakButton({
  turnId,
  text,
  agentId,
}: {
  turnId: string;
  text: string;
  agentId: string;
}) {
  const ready = useCommanderVoice().data?.ready;
  const speaking = useSpeaking() === turnId;
  const title = !ready
    ? "Download a voice in Settings > Models to hear replies"
    : speaking
      ? "Stop reading"
      : "Read aloud";
  const onClick = () => {
    if (!ready) void window.api.settings.open("models");
    else if (speaking) stopSpeaking();
    else void speakReply(turnId, text, agentId);
  };
  const Icon = speaking ? Square : Volume2;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "rounded p-0.5 text-text-muted hover:text-text-primary",
        speaking && "text-accent",
        !ready && "opacity-60",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
