import { isAbsolute, join, relative } from "node:path";
import { DICTATION_SAMPLE_RATE, type SpeechModelEntry } from "@exegol/shared";

/** What the engine process builds: an offline recognizer (decode after stop) or an online one
 *  (partial text while listening). `config` is sherpa-onnx-node's recognizer config */
export interface RecognizerSpec {
  kind: "offline" | "online";
  config: {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/** The vocabulary a recognizer is built with. Files live under the vocabulary folder (main
 *  writes them), never in the models folder */
export interface VocabularySpec {
  terms: string[];
  score: number;
  /** One term per line, for transducers decoded with modified_beam_search */
  hotwordsFile: string;
  /** sentencepiece vocab derived from the model's tokens.txt: lets hotwords be plain words */
  bpeVocab: string;
}

type Builder = (
  file: (name: string) => string,
  numThreads: number,
  vocab: VocabularySpec | null,
) => RecognizerSpec;

const offline = (
  modelConfig: Record<string, unknown>,
  numThreads: number,
  extra: Record<string, unknown> = {},
): RecognizerSpec => ({
  kind: "offline",
  config: {
    featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim: 80 },
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

// Per catalog id: the sherpa-onnx model family and the file names inside its folder
const BUILDERS: Record<string, Builder> = {
  "parakeet-tdt-0.6b-v3-int8": (file, numThreads, vocab) =>
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
            decodingMethod: "modified_beam_search",
            maxActivePaths: 4,
            hotwordsFile: vocab.hotwordsFile,
            hotwordsScore: vocab.score,
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
  "qwen3-asr-0.6b-int8": (file, numThreads, vocab) =>
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
  "moonshine-v2-tiny-en": moonshine,
  "moonshine-v2-base-es": moonshine,
};

export const hasRecognizer = (id: string): boolean => id in BUILDERS;

/** Models whose sherpa-onnx recognizer takes a vocabulary: hotwords on Parakeet's NeMo transducer
 *  (modified_beam_search, offline only), a prompt on Qwen3-ASR. Whisper, Moonshine and the
 *  streaming Nemotron (greedy only for NeMo online) have no biasing in sherpa-onnx 1.13 */
const VOCABULARY_USE: Record<string, "hotwords" | "prompt"> = {
  "parakeet-tdt-0.6b-v3-int8": "hotwords",
  "qwen3-asr-0.6b-int8": "prompt",
};

export const vocabularyUse = (id: string): "hotwords" | "prompt" | null =>
  VOCABULARY_USE[id] ?? null;

/** The recognizer for a catalog model installed in `dir`; null for a model the engine lacks */
export function recognizerSpec(
  entry: SpeechModelEntry,
  dir: string,
  numThreads: number,
  vocab: VocabularySpec | null = null,
): RecognizerSpec | null {
  const build = BUILDERS[entry.id];
  const used = vocab && vocab.terms.length > 0 && vocabularyUse(entry.id) ? vocab : null;
  return build ? build((name) => join(dir, name), numThreads, used) : null;
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
