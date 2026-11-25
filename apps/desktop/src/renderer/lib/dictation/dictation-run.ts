import type { DictationSettings, DictationStopReason } from "@exegol/shared";
import type { Capture } from "./capture";
import type { DictationTarget } from "./target";
import type { VadState } from "./vad";

export interface Run {
  settings: DictationSettings;
  target: DictationTarget;
  /** The app's own text field that had the focus, when that is the target */
  field: HTMLElement | null;
  capture: Capture | null;
  sessionId: string | null;
  /** Chunks captured before the session id came back */
  early: Float32Array[];
  vad: VadState;
  /** Loudest sample sent: a dictation that stays flat heard nothing from the mic */
  peak: number;
  cancelled: boolean;
  /** Paused: chunks are dropped here, before IPC, and the VAD does not count them */
  paused: boolean;
  /** Stopped while the mic was opening: stops once it listens, for this reason */
  stopWhenReady: DictationStopReason | null;
  /** A click on the countdown: this dictation no longer inserts on its own */
  autoInsertOff: boolean;
}
