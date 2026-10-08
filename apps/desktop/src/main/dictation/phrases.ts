import { DICTATION_SAMPLE_RATE, rms, SPEECH_RMS } from "@exegol/shared";

/** A pause this long after speech ends a phrase */
export const PHRASE_PAUSE_MS = 500;
/** Less speech than this is a click or a breath, not a phrase */
const PHRASE_MIN_SPEECH_MS = 250;
/** Whisper decodes 30-second windows: a phrase never grows past this */
const PHRASE_MAX_MS = 25_000;
/** Kept before the first loud chunk: words start softer than the threshold */
const PREROLL_SAMPLES = DICTATION_SAMPLE_RATE * 0.3;
/** At the cap, the cut moves back to the quietest frame of this last stretch, between words */
const CAP_LOOKBACK_SAMPLES = DICTATION_SAMPLE_RATE * 2;
const FRAME_SAMPLES = DICTATION_SAMPLE_RATE * 0.02;
/** Whisper pays a full 30 s window per decode: pauses cut only phrases at least this long */
export const WHISPER_MIN_PHRASE_MS = 10_000;

export interface Segmenter {
  /** Sample index where the current phrase starts */
  start: number;
  /** Samples seen so far */
  end: number;
  speechMs: number;
  silenceMs: number;
  /** Energy of each 20 ms frame in the last 2 s, by start sample */
  frames: { at: number; energy: number }[];
}

export const SEGMENTER_START: Segmenter = {
  start: 0,
  end: 0,
  speechMs: 0,
  silenceMs: 0,
  frames: [],
};

const msOf = (samples: number) => (samples / DICTATION_SAMPLE_RATE) * 1000;

function addFrames(state: Segmenter, chunk: Float32Array, end: number): Segmenter["frames"] {
  const frames = state.frames.filter((f) => f.at >= end - CAP_LOOKBACK_SAMPLES);
  for (let i = 0; i < chunk.length; i += FRAME_SAMPLES) {
    frames.push({ at: state.end + i, energy: rms(chunk.subarray(i, i + FRAME_SAMPLES)) });
  }
  return frames;
}

/** The middle of the quietest frame of the last 2 s, so a capped phrase does not split a word */
function quietestPoint(frames: Segmenter["frames"], start: number, end: number): number {
  let best: Segmenter["frames"][number] | null = null;
  for (const f of frames) {
    if (f.at > start && (!best || f.energy < best.energy)) best = f;
  }
  return best ? Math.min(end, best.at + FRAME_SAMPLES / 2) : end;
}

/** Feeds one chunk; `cut` is the end of a finished phrase ([state.start, cut) is ready to decode).
 *  A pause cuts only a phrase of `minPhraseMs` or more; the 25 s cap always cuts */
export function segment(
  state: Segmenter,
  chunk: Float32Array,
  minPhraseMs = 0,
): { state: Segmenter; cut: { from: number; to: number } | null } {
  const chunkMs = msOf(chunk.length);
  const end = state.end + chunk.length;
  const frames = addFrames(state, chunk, end);
  const speech = rms(chunk) >= SPEECH_RMS;
  const speechMs = state.speechMs + (speech ? chunkMs : 0);
  const silenceMs = speech ? 0 : state.silenceMs + chunkMs;
  const paused =
    speechMs >= PHRASE_MIN_SPEECH_MS &&
    silenceMs >= PHRASE_PAUSE_MS &&
    msOf(end - state.start) >= minPhraseMs;
  if (paused) {
    return {
      state: { start: end, end, speechMs: 0, silenceMs: 0, frames },
      cut: { from: state.start, to: end },
    };
  }
  if (msOf(end - state.start) >= PHRASE_MAX_MS) {
    const to = quietestPoint(frames, state.start, end);
    const rest = msOf(end - to);
    return {
      state: { start: to, end, speechMs: speech ? rest : 0, silenceMs: speech ? 0 : rest, frames },
      cut: { from: state.start, to },
    };
  }
  // A long silence before any speech: drop it from the next phrase
  if (speechMs === 0) {
    const start = Math.max(state.start, end - PREROLL_SAMPLES);
    return { state: { start, end, speechMs, silenceMs, frames }, cut: null };
  }
  return { state: { ...state, end, speechMs, silenceMs, frames }, cut: null };
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
