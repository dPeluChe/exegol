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
  startedAt: number;
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
  /** The overlay's Download was pressed: dictation starts once the model is ready */
  downloadRequested: boolean;
  set: (patch: Partial<Omit<DictationStore, "set">>) => void;
}

export const useDictationStore = create<DictationStore>((set) => ({
  phase: "idle",
  sessionId: null,
  startedAt: 0,
  anchorPaneId: null,
  targetKind: "clipboard",
  targetAgentId: null,
  targetProjectId: null,
  partial: "",
  error: null,
  modelLoading: false,
  downloadRequested: false,
  set: (patch) => set(patch),
}));

export const isRecording = (phase: DictationPhase): boolean =>
  phase === "starting" || phase === "listening";
