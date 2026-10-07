import type { DictationStatus } from "@exegol/shared";
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
  /** Streaming models: what was understood so far */
  partial: string;
  error: string | null;
  status: DictationStatus | null;
  modelLoading: boolean;
  set: (patch: Partial<Omit<DictationStore, "set">>) => void;
}

export const useDictationStore = create<DictationStore>((set) => ({
  phase: "idle",
  sessionId: null,
  startedAt: 0,
  anchorPaneId: null,
  partial: "",
  error: null,
  status: null,
  modelLoading: false,
  set: (patch) => set(patch),
}));

export const isRecording = (phase: DictationPhase): boolean =>
  phase === "starting" || phase === "listening";
