/** Energy voice detection: enough to tell "nothing was said" and to stop after a pause. Mic
 *  capture runs with auto gain, so speech sits well above this RMS and room noise below it */
export const SPEECH_RMS = 0.008;
/** Speech this long in total counts as "heard": a click or a cough does not */
const HEARD_MS = 150;

export interface VadState {
  speechMs: number;
  /** Silence since the last speech */
  silenceMs: number;
  heard: boolean;
}

export const VAD_START: VadState = { speechMs: 0, silenceMs: 0, heard: false };

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

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

/** Auto-stop (0 = off) once speech was heard and the pause ran long enough */
export const shouldAutoStop = (state: VadState, autoStopSec: number): boolean =>
  autoStopSec > 0 && state.heard && state.silenceMs >= autoStopSec * 1000;
