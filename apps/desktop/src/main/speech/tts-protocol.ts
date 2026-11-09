import type { TtsSpec } from "./tts-config";

/** Main → speech process. Texts are spoken data: never logged */
export type TtsRequest =
  | { type: "speak"; id: string; spec: TtsSpec; sid: number; speed: number; sentences: string[] }
  | { type: "cancel"; id: string };

/** Speech process → main */
export type TtsReply =
  | { type: "ready" }
  | { type: "audio"; id: string; samples: Float32Array; sampleRate: number }
  | { type: "done"; id: string; sentences: number; loadMs: number; synthMs: number }
  | { type: "failed"; id: string; error: string };
