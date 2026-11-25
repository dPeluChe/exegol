import { formatChord, type KeyChord } from "@exegol/shared";
import { Mic, Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import {
  dismissDictation,
  stopDictation,
  togglePauseDictation,
} from "../../lib/dictation/controller";
import { dictationChord } from "../../lib/dictation/shortcut";
import { appKeys, IS_MAC } from "../../lib/keymap";
import { type DictationPhase, isRecording, useDictationStore } from "../../stores/dictation";
import { Kbd } from "../common/Kbd";
import { OverlayButton } from "./overlay-ui";

const MAC_GLYPHS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Shift: "⇧", Option: "⌥" };

/** The chord's keys for this platform: glyphs on macOS, words elsewhere */
const chordKeys = (chord: KeyChord): string[] =>
  formatChord(chord, IS_MAC)
    .split("+")
    .map((k) => (IS_MAC ? (MAC_GLYPHS[k] ?? k) : k));

/** The pill's keycaps that also click: Insert (accent) and Esc cancel (neutral) */
export function Commands({ phase }: { phase: DictationPhase }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {isRecording(phase) && <InsertButton compact />}
      <CancelButton />
    </div>
  );
}

export function InsertButton({ compact = false }: { compact?: boolean }) {
  const chord = dictationChord();
  const keys = chord && !compact ? chordKeys(chord) : [];
  const enter = IS_MAC ? "↵" : "Enter";
  return (
    <OverlayButton
      variant="insert"
      label={chord ? `Insert (Enter or ${formatChord(chord, IS_MAC)})` : "Insert (Enter)"}
      title={`Insert: ${[enter, chord ? chordKeys(chord).join("") : ""].filter(Boolean).join(" or ")}`}
      onClick={() => void stopDictation("button")}
    >
      <KeyCap>{enter}</KeyCap>
      {keys.length > 0 && (
        <>
          <span>or</span>
          <span className="inline-flex gap-0.5">
            {keys.map((k) => (
              <KeyCap key={k}>{k}</KeyCap>
            ))}
          </span>
        </>
      )}
      <span>insert</span>
    </OverlayButton>
  );
}

/** Pause the recording and pick it up again: same session, same text so far */
export function PauseButton({ paused }: { paused: boolean }) {
  const keys = appKeys("Cmd+P");
  const word = paused ? "Resume" : "Pause";
  return (
    <OverlayButton
      variant="cancel"
      label={`${word} (${keys})`}
      title={`${word}: ${keys}`}
      onClick={togglePauseDictation}
    >
      {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      <span>{paused ? "resume" : "pause"}</span>
    </OverlayButton>
  );
}

/** The mic this dictation opened */
export function InputName() {
  const name = useDictationStore((s) => s.inputName);
  if (!name) return <span className="flex-1" />;
  return (
    <span
      title={`Input: ${name}`}
      className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 text-[10px] text-text-muted"
    >
      <Mic className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function InputNotice() {
  const notice = useDictationStore((s) => s.inputNotice);
  if (!notice) return null;
  return <p className="truncate px-3.5 pb-1.5 text-[10px] text-warning">{notice}</p>;
}

export const CancelButton = () => (
  <OverlayButton
    variant="cancel"
    label="Cancel (Esc)"
    title="Cancel: Esc"
    onClick={() => dismissDictation("button")}
  >
    <KeyCap>Esc</KeyCap>
    <span>cancel</span>
  </OverlayButton>
);

const KeyCap = ({ children }: { children: ReactNode }) => (
  <Kbd className="h-5 min-w-5 px-1">{children}</Kbd>
);
