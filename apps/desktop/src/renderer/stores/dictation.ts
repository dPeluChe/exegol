import type { DictationTargetKind } from "@exegol/shared";
import { create } from "zustand";

/** idle: nothing on screen. The other phases show the overlay */
export type DictationPhase =
  | "idle"
  | "starting"
  | "listening"
  | "transcribing"
  | "no-model"
  | "mic-denied"
  | "error";

interface DictationStore {
  phase: DictationPhase;
  sessionId: string | null;
  /** Shifted forward by each pause on resume, so now - startedAt is the time recorded */
  startedAt: number;
  /** Set while paused: the mic stays open, no audio leaves, the timer stands still */
  pausedAt: number | null;
  /** The pane the overlay sits over (the one the text goes to), null = the window */
  anchorPaneId: string | null;
  /** Where Insert puts the text, for the overlay (insertHint) */
  targetKind: DictationTargetKind;
  /** The terminal target's session and the target's project, for the overlay's chip */
  targetAgentId: string | null;
  targetProjectId: string | null;
  /** What was understood so far: live for streaming models, phrase by phrase for the others */
  partial: string;
  error: string | null;
  modelLoading: boolean;
  /** The mic this dictation opened, for the overlay's footer */
  inputName: string | null;
  /** The picked mic was missing: the overlay says the system default is used */
  inputNotice: string | null;
  /** Auto insert's last seconds: what is left before it inserts, null outside the countdown */
  autoInsertMs: number | null;
  /** The overlay's Download was pressed: dictation starts once the model is ready */
  downloadRequested: boolean;
  set: (patch: Partial<Omit<DictationStore, "set">>) => void;
}

export const useDictationStore = create<DictationStore>((set) => ({
  phase: "idle",
  sessionId: null,
  startedAt: 0,
  pausedAt: null,
  anchorPaneId: null,
  targetKind: "clipboard",
  targetAgentId: null,
  targetProjectId: null,
  partial: "",
  error: null,
  modelLoading: false,
  inputName: null,
  inputNotice: null,
  downloadRequested: false,
  autoInsertMs: null,
  set: (patch) => set(patch),
}));

export const isRecording = (phase: DictationPhase): boolean =>
  phase === "starting" || phase === "listening";

/** Time recorded so far: a pause stops the count */
export const recordedMs = (s: { startedAt: number; pausedAt: number | null }, now = Date.now()) =>
  Math.max(0, (s.pausedAt ?? now) - s.startedAt);
