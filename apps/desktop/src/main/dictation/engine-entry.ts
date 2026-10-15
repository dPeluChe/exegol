/**
 * Speech engine, run as an Electron utilityProcess: sherpa-onnx-node (N-API, no per-Electron
 * rebuild) decodes here so a model load or a long decode never blocks the main process.
 * It only opens files under the models and vocabulary folders main passes at fork.
 */
import { realpathSync } from "node:fs";
import { DICTATION_SAMPLE_RATE as SAMPLE_RATE } from "@exegol/shared";
import * as sherpa from "sherpa-onnx-node";
import type { EngineReply, EngineRequest } from "./engine-protocol";
import { isInside, type RecognizerSpec, specPaths } from "./model-config";
import {
  decodeWithVocabulary,
  joinPhrases,
  SEGMENTER_START,
  type Segmenter,
  segment,
  tailHasSpeech,
  WHISPER_MIN_PHRASE_MS,
} from "./phrases";

const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(name))?.slice(name.length) || undefined;
const modelsRoot = flag("--models-root=");
const vocabRoot = flag("--vocab-root=");

type Loaded =
  | { kind: "offline"; recognizer: sherpa.OfflineRecognizer }
  | { kind: "online"; recognizer: sherpa.OnlineRecognizer };

interface Session {
  id: string;
  maxSamples: number;
  total: number;
  pending: Float32Array[];
  online?: sherpa.OnlineStream;
  lastPartial: string;
  /** Offline models: every chunk (the full-pass fallback), the current phrase's chunks with
   *  their start sample, the phrases decoded so far, in order */
  all: Float32Array[];
  phrase: { at: number; samples: Float32Array }[];
  seg: Segmenter;
  texts: string[];
  decoding: Promise<void>;
  phraseMs: number;
  /** Phrases decoded without the vocabulary (little speech, or the biased text repeated itself) */
  unbiased: number;
  /** A phrase decode threw: finish decodes everything in one pass instead */
  phraseFailed: boolean;
  /** Cancelled or replaced: its queued phrase decodes do not run */
  cancelled: boolean;
}

let loadedKey: string | null = null;
let loaded: Loaded | null = null;
/** The loaded model's vocabulary, given per stream */
let hotwords: string | null = null;
/** Pauses cut only phrases at least this long (Whisper decodes a 30 s window per phrase) */
let minPhraseMs = 0;
let loading: Promise<void> | null = null;
let session: Session | null = null;

const port = process.parentPort;
const reply = (message: EngineReply) => port.postMessage(message);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function assertModelPaths(spec: RecognizerSpec): void {
  if (!modelsRoot) throw new Error("no models folder");
  const roots = [modelsRoot, vocabRoot].flatMap((r) => {
    try {
      return r ? [realpathSync(r)] : [];
    } catch {
      return [];
    }
  });
  for (const path of specPaths(spec.config)) {
    const real = realpathSync(path);
    if (!roots.some((root) => isInside(root, real)))
      throw new Error("model file outside the models folder");
  }
}

async function load(modelId: string, key: string, spec: RecognizerSpec): Promise<void> {
  // Set before the await: a "hotwords" message sent during the load wins
  hotwords = spec.hotwords ?? null;
  if (loadedKey === key && loaded) {
    reply({ type: "loaded", modelId });
    return;
  }
  loaded = null;
  loadedKey = null;
  try {
    assertModelPaths(spec);
    loaded =
      spec.kind === "offline"
        ? { kind: "offline", recognizer: await sherpa.OfflineRecognizer.createAsync(spec.config) }
        : { kind: "online", recognizer: new sherpa.OnlineRecognizer(spec.config) };
    loadedKey = key;
    minPhraseMs = spec.config.modelConfig.whisper ? WHISPER_MIN_PHRASE_MS : 0;
    reply({ type: "loaded", modelId });
  } catch (err) {
    reply({ type: "load-failed", modelId, error: errorText(err) });
  }
}

/** Streaming: feed what arrived and send the partial text when it changed */
function pump(s: Session): void {
  if (loaded?.kind !== "online") return;
  const { recognizer } = loaded;
  s.online ??= recognizer.createStream();
  for (const samples of s.pending.splice(0)) {
    s.online.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  }
  while (recognizer.isReady(s.online)) recognizer.decode(s.online);
  const text = recognizer.getResult(s.online).text.trim();
  if (text !== s.lastPartial) {
    s.lastPartial = text;
    reply({ type: "partial", sessionId: s.id, text });
  }
}

async function decodeOffline(s: Session, samples: Float32Array, speechMs: number): Promise<string> {
  await loading;
  if (loaded?.kind !== "offline") throw new Error("the model did not load");
  const { recognizer } = loaded;
  const run = async (words: string | null): Promise<string> => {
    const stream = words ? recognizer.createStream(words) : recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    return (await recognizer.decodeAsync(stream)).text.trim();
  };
  const { text, unbiased } = await decodeWithVocabulary(run, hotwords, speechMs);
  if (unbiased) s.unbiased++;
  return text;
}

/** [from, to) of the current phrase's chunks as one buffer */
function phraseAudio(s: Session, from: number, to: number): Float32Array {
  const parts = s.phrase.filter((c) => c.at + c.samples.length > from && c.at < to);
  const first = parts[0]?.at ?? from;
  const joined = concat(
    parts.map((c) => c.samples),
    parts.reduce((n, c) => n + c.samples.length, 0),
  );
  return joined.subarray(Math.max(0, from - first), Math.max(0, to - first));
}

/** Offline models: cut at pauses, decode each phrase while the user keeps talking */
function addOffline(s: Session, samples: Float32Array): void {
  s.all.push(samples);
  s.phrase.push({ at: s.seg.end, samples });
  const { state, cut } = segment(s.seg, samples, minPhraseMs);
  s.seg = state;
  if (cut) {
    const audio = phraseAudio(s, cut.from, cut.to);
    const index = s.texts.push("") - 1;
    s.decoding = s.decoding.then(async () => {
      if (s.cancelled) return;
      const started = Date.now();
      try {
        s.texts[index] = await decodeOffline(s, audio, cut.speechMs);
      } catch {
        s.phraseFailed = true;
      }
      s.phraseMs += Date.now() - started;
      if (session === s) reply({ type: "partial", sessionId: s.id, text: joinPhrases(s.texts) });
    });
  }
  s.phrase = s.phrase.filter((c) => c.at + c.samples.length > s.seg.start);
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

interface Finished {
  text: string;
  phrases: number;
  phraseMs: number;
  fullPass: boolean;
  unbiased: number;
}

const EMPTY_FINISH: Finished = { text: "", phrases: 0, phraseMs: 0, fullPass: false, unbiased: 0 };

async function finish(s: Session): Promise<Finished> {
  await loading;
  if (!loaded) throw new Error("the model did not load");
  if (loaded.kind === "offline") {
    for (const samples of s.pending.splice(0)) addOffline(s, samples);
    await s.decoding;
    if (tailHasSpeech(s.seg) && !s.phraseFailed) {
      const tail = await decodeOffline(
        s,
        phraseAudio(s, s.seg.start, s.seg.end),
        s.seg.speechMs,
      ).catch(() => {
        s.phraseFailed = true;
        return "";
      });
      s.texts.push(tail);
    }
    const done = (text: string, fullPass: boolean): Finished => ({
      text,
      phrases: s.texts.length,
      phraseMs: s.phraseMs,
      fullPass,
      unbiased: s.unbiased,
    });
    const joined = joinPhrases(s.texts);
    if (!s.phraseFailed && (joined || s.total === 0)) return done(joined, false);
    // A phrase failed, or cuts split a short utterance badly: one pass over everything
    return done(await decodeOffline(s, concat(s.all, s.total), Number.POSITIVE_INFINITY), true);
  }
  // Trailing silence lets the streaming model emit its last words (upstream example: 0.4 s)
  s.pending.push(new Float32Array(SAMPLE_RATE * 0.4));
  pump(s);
  const { recognizer } = loaded;
  const stream = s.online;
  if (!stream) return EMPTY_FINISH;
  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  return { ...EMPTY_FINISH, text: recognizer.getResult(stream).text.trim() };
}

function handle(msg: EngineRequest): void {
  switch (msg.type) {
    case "load":
      loading = load(msg.modelId, msg.key, msg.spec);
      return;
    case "hotwords":
      hotwords = msg.hotwords;
      return;
    case "begin":
      if (session) session.cancelled = true;
      session = {
        id: msg.sessionId,
        maxSamples: msg.maxSamples,
        total: 0,
        pending: [],
        lastPartial: "",
        all: [],
        phrase: [],
        seg: SEGMENTER_START,
        texts: [],
        decoding: Promise.resolve(),
        phraseMs: 0,
        unbiased: 0,
        phraseFailed: false,
        cancelled: false,
      };
      return;
    case "audio": {
      const s = session;
      if (s?.id !== msg.sessionId || !(msg.samples instanceof Float32Array)) return;
      const room = s.maxSamples - s.total;
      if (room <= 0) return;
      const samples = msg.samples.length > room ? msg.samples.subarray(0, room) : msg.samples;
      s.total += samples.length;
      try {
        // Before the model is loaded its kind is unknown: chunks wait in `pending`
        if (loaded?.kind === "offline") {
          for (const early of s.pending.splice(0)) addOffline(s, early);
          addOffline(s, samples);
          return;
        }
        s.pending.push(samples);
        pump(s);
      } catch (err) {
        s.cancelled = true;
        session = null;
        reply({ type: "failed", sessionId: s.id, error: errorText(err) });
      }
      return;
    }
    case "finish": {
      const s = session;
      if (s?.id !== msg.sessionId) {
        reply({ type: "failed", sessionId: msg.sessionId, error: "no such dictation" });
        return;
      }
      session = null;
      finish(s).then(
        (done) => reply({ type: "final", sessionId: s.id, ...done }),
        (err) => reply({ type: "failed", sessionId: s.id, error: errorText(err) }),
      );
      return;
    }
    case "cancel":
      if (session?.id === msg.sessionId) {
        session.cancelled = true;
        session = null;
      }
      return;
  }
}

port.on("message", (event) => handle(event.data as EngineRequest));
// The addon loaded (a static import): main's availability probe waits for this
reply({ type: "ready" });
