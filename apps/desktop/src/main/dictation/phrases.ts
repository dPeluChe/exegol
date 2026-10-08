import { DICTATION_SAMPLE_RATE, rms, SPEECH_RMS } from "@exegol/shared";

/** A pause this long after speech ends a phrase */
export const PHRASE_PAUSE_MS = 500;
/** Less speech than this is a click or a breath, not a phrase */
const PHRASE_MIN_SPEECH_MS = 250;
/** Whisper decodes 30-second windows: a phrase never grows past this */
const PHRASE_MAX_MS = 25_000;
/** Kept before the first loud chunk: words start softer than the threshold */
const PREROLL_SAMPLES = DICTATION_SAMPLE_RATE * 0.3;

export interface Segmenter {
  /** Sample index where the current phrase starts */
  start: number;
  /** Samples seen so far */
  end: number;
  speechMs: number;
  silenceMs: number;
}

export const SEGMENTER_START: Segmenter = { start: 0, end: 0, speechMs: 0, silenceMs: 0 };

const msOf = (samples: number) => (samples / DICTATION_SAMPLE_RATE) * 1000;

/** Feeds one chunk; `cut` is the end of a finished phrase ([state.start, cut) is ready to decode) */
export function segment(
  state: Segmenter,
  chunk: Float32Array,
): { state: Segmenter; cut: { from: number; to: number } | null } {
  const chunkMs = msOf(chunk.length);
  const end = state.end + chunk.length;
  const speech = rms(chunk) >= SPEECH_RMS;
  const speechMs = state.speechMs + (speech ? chunkMs : 0);
  const silenceMs = speech ? 0 : state.silenceMs + chunkMs;
  const paused = speechMs >= PHRASE_MIN_SPEECH_MS && silenceMs >= PHRASE_PAUSE_MS;
  if (paused || msOf(end - state.start) >= PHRASE_MAX_MS) {
    return {
      state: { start: end, end, speechMs: 0, silenceMs: 0 },
      cut: { from: state.start, to: end },
    };
  }
  // A long silence before any speech: drop it from the next phrase
  if (speechMs === 0) {
    const start = Math.max(state.start, end - PREROLL_SAMPLES);
    return { state: { start, end, speechMs, silenceMs }, cut: null };
  }
  return { state: { ...state, end, speechMs, silenceMs }, cut: null };
}

/** The audio after the last cut is worth decoding at stop */
export const tailHasSpeech = (state: Segmenter): boolean =>
  state.end > state.start && state.speechMs >= PHRASE_MIN_SPEECH_MS;

export function joinPhrases(texts: readonly string[]): string {
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}
