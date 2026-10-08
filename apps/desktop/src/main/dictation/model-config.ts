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

type Builder = (file: (name: string) => string, numThreads: number) => RecognizerSpec;

const offline = (
  modelConfig: Record<string, unknown>,
  numThreads: number,
  featureDim = 80,
): RecognizerSpec => ({
  kind: "offline",
  config: {
    featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim },
    modelConfig: { ...modelConfig, numThreads, provider: "cpu", debug: 0 },
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
  "parakeet-tdt-0.6b-v3-int8": (file, numThreads) =>
    offline(
      { transducer: transducer(file), tokens: file("tokens.txt"), modelType: "nemo_transducer" },
      numThreads,
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
  "qwen3-asr-0.6b-int8": (file, numThreads) =>
    offline(
      {
        qwen3Asr: {
          convFrontend: file("conv_frontend.onnx"),
          encoder: file("encoder.int8.onnx"),
          decoder: file("decoder.int8.onnx"),
          tokenizer: file("tokenizer"),
          hotwords: "",
        },
        tokens: "",
      },
      numThreads,
    ),
  "moonshine-v2-tiny-en": moonshine,
  "moonshine-v2-base-es": moonshine,
};

export const hasRecognizer = (id: string): boolean => id in BUILDERS;

/** The recognizer for a catalog model installed in `dir`; null for a model the engine lacks */
export function recognizerSpec(
  entry: SpeechModelEntry,
  dir: string,
  numThreads: number,
): RecognizerSpec | null {
  const build = BUILDERS[entry.id];
  return build ? build((name) => join(dir, name), numThreads) : null;
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
