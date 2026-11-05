import { SPEECH_RMS } from "@exegol/shared";

export { rms, SPEECH_RMS } from "@exegol/shared";

/** Speech this long in total counts as "heard": a click or a cough does not */
const HEARD_MS = 150;

export interface VadState {
  speechMs: number;
  /** Silence since the last speech */
  silenceMs: number;
  heard: boolean;
}

export const VAD_START: VadState = { speechMs: 0, silenceMs: 0, heard: false };

export function updateVad(
  state: VadState,
  level: number,
  chunkMs: number,
  threshold = SPEECH_RMS,
): VadState {
  if (level >= threshold) {
    const speechMs = state.speechMs + chunkMs;
    return { speechMs, silenceMs: 0, heard: state.heard || speechMs >= HEARD_MS };
  }
  return { ...state, silenceMs: state.silenceMs + chunkMs };
}
