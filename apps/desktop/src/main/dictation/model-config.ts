import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";
import {
  DICTATION_SAMPLE_RATE,
  type DictationLanguage,
  type SpeechModelEntry,
} from "@exegol/shared";

/** What the engine process builds: an offline recognizer (decode after stop) or an online one
 *  (partial text while listening). `config` is sherpa-onnx-node's recognizer config */
export interface RecognizerSpec {
  kind: "offline" | "online";
  /** Parakeet's terms, "/"-separated, given per stream: a phrase with little speech decodes
   *  without them (the recognizer's own hotwords file could not be turned off per phrase) */
  hotwords?: string;
  config: {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/** The vocabulary a recognizer is built with. Its file lives under the vocabulary folder (main
 *  writes it), never in the models folder */
export interface VocabularySpec {
  terms: string[];
  score: number;
  /** `vocabularyHash(terms, score)`, computed once per vocabulary */
  hash: string;
  /** sentencepiece vocab derived from the model's tokens.txt: lets hotwords be plain words */
  bpeVocab: string;
}

type Builder = (
  file: (name: string) => string,
  numThreads: number,
  language: DictationLanguage,
  vocab: VocabularySpec | null,
) => RecognizerSpec;

const offline = (
  modelConfig: Record<string, unknown>,
  numThreads: number,
  {
    extra = {},
    featureDim = 80,
    hotwords,
  }: { extra?: Record<string, unknown>; featureDim?: number; hotwords?: string } = {},
): RecognizerSpec => ({
  kind: "offline",
  ...(hotwords ? { hotwords } : {}),
  config: {
    featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim },
    modelConfig: { ...modelConfig, numThreads, provider: "cpu", debug: 0 },
    ...extra,
  },
});

const transducer = (file: (name: string) => string) => ({
  encoder: file("encoder.int8.onnx"),
  decoder: file("decoder.int8.onnx"),
  joiner: file("joiner.int8.onnx"),
});

const moonshine: Builder = (file, numThreads) =>
  offline(
    {
      moonshine: {
        encoder: file("encoder_model.ort"),
        mergedDecoder: file("decoder_model_merged.ort"),
      },
      tokens: file("tokens.txt"),
    },
    numThreads,
  );

// Models that run in one set language; the others detect it, so their recognizer ignores it
const NEEDS_LANGUAGE = new Set(["canary-180m-flash-int8"]);

// Per catalog id: the sherpa-onnx model family and the file names inside its folder
const BUILDERS: Record<string, Builder> = {
  "parakeet-tdt-0.6b-v3-int8": (file, numThreads, _language, vocab) =>
    offline(
      {
        transducer: transducer(file),
        tokens: file("tokens.txt"),
        modelType: "nemo_transducer",
        ...(vocab ? { modelingUnit: "bpe", bpeVocab: vocab.bpeVocab } : {}),
      },
      numThreads,
      vocab
        ? {
            extra: {
              decodingMethod: "modified_beam_search",
              maxActivePaths: 4,
              hotwordsScore: vocab.score,
            },
            hotwords: vocab.terms.join("/"),
          }
        : {},
    ),
  "whisper-large-v3-turbo-int8": (file, numThreads) =>
    offline(
      {
        whisper: {
          encoder: file("turbo-encoder.int8.onnx"),
          decoder: file("turbo-decoder.int8.onnx"),
          language: "",
          task: "transcribe",
        },
        tokens: file("turbo-tokens.txt"),
      },
      numThreads,
    ),
  "nemotron-3.5-asr-streaming-0.6b-560ms-int8": (file, numThreads) => ({
    kind: "online",
    config: {
      featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim: 128 },
      modelConfig: {
        transducer: transducer(file),
        tokens: file("tokens.txt"),
        numThreads,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      enableEndpoint: 0,
    },
  }),
  "qwen3-asr-0.6b-int8": (file, numThreads, _language, vocab) =>
    offline(
      {
        qwen3Asr: {
          convFrontend: file("conv_frontend.onnx"),
          encoder: file("encoder.int8.onnx"),
          decoder: file("decoder.int8.onnx"),
          tokenizer: file("tokenizer"),
          hotwords: vocab?.terms.join(",") ?? "",
        },
        tokens: "",
      },
      numThreads,
    ),
  // Same language in and out: speech in another one comes out translated into it
  "canary-180m-flash-int8": (file, numThreads, language) =>
    offline(
      {
        canary: {
          encoder: file("encoder.int8.onnx"),
          decoder: file("decoder.int8.onnx"),
          srcLang: language,
          tgtLang: language,
          usePnc: 1,
        },
        tokens: file("tokens.txt"),
      },
      numThreads,
      { featureDim: 128 },
    ),
  "moonshine-v2-tiny-en": moonshine,
  "moonshine-v2-base-es": moonshine,
};

export const hasRecognizer = (id: string): boolean => id in BUILDERS;

/** Hotwords per stream (Parakeet) or a prompt (Qwen3-ASR); the other models have no biasing in
 *  sherpa-onnx 1.13 */
const VOCABULARY_USE: Record<string, "hotwords" | "prompt"> = {
  "parakeet-tdt-0.6b-v3-int8": "hotwords",
  "qwen3-asr-0.6b-int8": "prompt",
};

export const vocabularyUse = (id: string): "hotwords" | "prompt" | null =>
  VOCABULARY_USE[id] ?? null;

/** The vocabulary a model is built with: none when it is empty or the model takes none */
const usedVocabulary = <T extends { terms: readonly string[] }>(id: string, vocab: T | null) =>
  vocab && vocab.terms.length > 0 && vocabularyUse(id) ? vocab : null;

export const vocabularyHash = (terms: readonly string[], score: number): string =>
  createHash("sha256").update(JSON.stringify({ terms, score })).digest("hex").slice(0, 12);

/** What the loaded recognizer is cached by: the language only for models it shapes. Hotwords go
 *  per stream, so only their decoding (beam search, score) is in the key: new terms never reload */
export function recognizerKey(
  id: string,
  language: DictationLanguage,
  vocab: Pick<VocabularySpec, "terms" | "score" | "hash"> | null = null,
): string {
  const lang = NEEDS_LANGUAGE.has(id) ? `:${language}` : "";
  const used = usedVocabulary(id, vocab);
  if (!used) return `${id}${lang}`;
  return `${id}${lang}#${vocabularyUse(id) === "hotwords" ? `beam${used.score}` : used.hash}`;
}

/** The recognizer for a catalog model installed in `dir`; null for a model the engine lacks */
export function recognizerSpec(
  entry: SpeechModelEntry,
  dir: string,
  numThreads: number,
  language: DictationLanguage,
  vocab: VocabularySpec | null = null,
): RecognizerSpec | null {
  const build = BUILDERS[entry.id];
  const used = usedVocabulary(entry.id, vocab);
  return build ? build((name) => join(dir, name), numThreads, language, used) : null;
}

/** tokens.txt ("piece id" per line) as the "piece<TAB>score" vocab sherpa-onnx's sentencepiece
 *  reads. Score -id: lower ids are the earlier, more frequent merges in a BPE model */
export function bpeVocabFromTokens(tokens: string): string {
  const lines: string[] = [];
  for (const line of tokens.split("\n")) {
    const at = line.lastIndexOf(" ");
    if (at <= 0) continue;
    const piece = line.slice(0, at);
    const id = Number(line.slice(at + 1));
    if (!Number.isInteger(id) || /^<.*>$/.test(piece)) continue;
    lines.push(`${piece}\t${-id}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every file path in a spec (any string value that is absolute) */
export function specPaths(value: unknown): string[] {
  if (typeof value === "string") return isAbsolute(value) ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(specPaths);
}

/** A path stays inside root (no "..", no other absolute place) */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
