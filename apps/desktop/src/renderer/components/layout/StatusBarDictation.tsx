import { formatChord } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Loader2, Mic } from "lucide-react";
import { toggleDictation } from "../../lib/dictation/controller";
import { dictationChord } from "../../lib/dictation/shortcut";
import { IS_MAC } from "../../lib/keymap";
import { isRecording, useDictationStore } from "../../stores/dictation";

/** Mic toggle: dictates into the focused pane. mouseDown keeps the focus there */
export function DictationWidget() {
  const phase = useDictationStore((s) => s.phase);
  const recording = isRecording(phase);
  const chord = dictationChord();
  const title = recording
    ? "Stop and insert"
    : `Dictate into the focused pane${chord ? ` (${formatChord(chord, IS_MAC)})` : ""}`;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggleDictation}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-5 items-center gap-1 rounded px-1 hover:bg-white/10 hover:text-text-primary",
        recording && "text-error",
      )}
    >
      {phase === "transcribing" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Mic className={cn("h-3 w-3", recording && "animate-pulse")} />
      )}
    </button>
  );
}
