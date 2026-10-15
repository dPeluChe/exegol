import type { RecognizerSpec } from "./model-config";

/** Main → engine process */
export type EngineRequest =
  /** A different `key` (`recognizerKey`) rebuilds the recognizer */
  | { type: "load"; modelId: string; key: string; spec: RecognizerSpec }
  /** New per-stream terms for the loaded recognizer (same key, no reload) */
  | { type: "hotwords"; hotwords: string | null }
  | { type: "begin"; sessionId: string; maxSamples: number }
  | { type: "audio"; sessionId: string; samples: Float32Array }
  | { type: "finish"; sessionId: string }
  | { type: "cancel"; sessionId: string };

/** Engine process → main. Texts are dictated data: never logged */
export type EngineReply =
  | { type: "ready" }
  | { type: "loaded"; modelId: string }
  | { type: "load-failed"; modelId: string; error: string }
  | { type: "partial"; sessionId: string; text: string }
  | {
      type: "final";
      sessionId: string;
      text: string;
      /** Offline models: phrases cut at pauses and decoded while recording */
      phrases: number;
      phraseMs: number;
      /** The phrases came back empty or one failed: everything was decoded again */
      fullPass: boolean;
      /** Phrases decoded without the vocabulary: too little speech, or the biased text repeated */
      unbiased: number;
    }
  | { type: "failed"; sessionId: string; error: string };
