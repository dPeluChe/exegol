import { speechLength } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Square, Volume2 } from "lucide-react";
import { useMemo } from "react";
import { speakReply, stopSpeaking, useSpeaking } from "../../../lib/speech/player";

/** Reads one reply aloud; while it plays, stops it. Without a voice installed, opens the Models tab */
export function SpeakButton({
  turnId,
  text,
  agentId,
  ready,
}: {
  turnId: string;
  text: string;
  agentId: string;
  ready: boolean;
}) {
  const speaking = useSpeaking(turnId);
  const length = useMemo(() => speechLength(text), [text]);
  const size = `${length.words.toLocaleString()} words, about ${length.minutes} min${
    length.cut ? ", the first part of a longer reply" : ""
  }`;
  const title = !ready
    ? "Download a voice in Settings > Models to hear replies"
    : speaking
      ? `Stop reading (${size})`
      : `Read aloud (${size})`;
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
        "flex items-center gap-1 rounded p-0.5 text-text-muted hover:text-text-primary",
        speaking && "text-accent",
        !ready && "opacity-60",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {speaking && (
        <span className="text-[9px] tabular-nums">
          {length.words.toLocaleString()} words{length.cut ? ", cut" : ""}
        </span>
      )}
    </button>
  );
}
