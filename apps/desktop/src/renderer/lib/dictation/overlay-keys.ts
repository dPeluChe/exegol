import type { DictationPhase } from "../../stores/dictation";

export type OverlayKeyAction = "insert" | "cancel" | "swallow" | null;

interface KeyInput {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** What a key does while the overlay is open; null leaves it to the focused pane or control.
 *  Enter inserts while recording, so it never reaches the target below; with another pane
 *  focused (`onTarget` false, the user moved on) Enter is that pane's */
export function overlayKeyAction(
  e: KeyInput,
  phase: DictationPhase,
  onTarget = true,
): OverlayKeyAction {
  if (phase === "idle") return null;
  // 229: an IME is composing; its Enter commits the composition, not the dictation
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.key === "Escape") return "cancel";
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (!onTarget) return null;
  if (phase === "starting" || phase === "listening") return "insert";
  return phase === "transcribing" ? "swallow" : null;
}
