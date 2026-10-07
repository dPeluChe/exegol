import type { RecognizerSpec } from "./model-config";

/** Main → engine process */
export type EngineRequest =
  | { type: "load"; modelId: string; spec: RecognizerSpec }
  | { type: "begin"; sessionId: string; maxSamples: number }
  | { type: "audio"; sessionId: string; samples: Float32Array }
  | { type: "finish"; sessionId: string }
  | { type: "cancel"; sessionId: string };

/** Engine process → main. Texts are dictated data: never logged */
export type EngineReply =
  | { type: "loaded"; modelId: string }
  | { type: "load-failed"; modelId: string; error: string }
  | { type: "partial"; sessionId: string; text: string }
  | { type: "final"; sessionId: string; text: string }
  | { type: "failed"; sessionId: string; error: string };

export const SAMPLE_RATE = 16_000;
