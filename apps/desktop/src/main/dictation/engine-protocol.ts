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
      /** The phrases came back empty and everything was decoded again */
      fullPass: boolean;
    }
  | { type: "failed"; sessionId: string; error: string };
