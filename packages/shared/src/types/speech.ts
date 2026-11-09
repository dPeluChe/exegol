/** Replies read aloud on the machine (T222). Spoken text never reaches a log */

export interface CommanderVoiceSettings {
  /** Read each new reply as it arrives */
  auto: boolean;
  /** A `VoiceSpeaker.id` of the installed voice model */
  voice: string;
  speed: number;
}

export const COMMANDER_VOICE_KEY = "commander_voice";
export const DEFAULT_VOICE_ID = "ef_dora";
export const SPEECH_SPEED_MIN = 0.5;
export const SPEECH_SPEED_MAX = 2;

export const DEFAULT_COMMANDER_VOICE: CommanderVoiceSettings = {
  auto: false,
  voice: DEFAULT_VOICE_ID,
  speed: 1,
};

/** Renderer to main, `speech:speak`. `auto`: a reply that just arrived, not a click */
export interface SpeakRequest {
  text: string;
  agentId: string;
  auto?: boolean;
}

export type SpeakResult =
  | { id: string }
  | { skipped: "empty" | "no-model" | "other-window" | "off" };

/** Main to the window that asked: one sentence of mono PCM */
export interface SpeechAudioEvent {
  id: string;
  samples: Float32Array;
  sampleRate: number;
}

/** No more audio for this utterance: finished, stopped or failed */
export interface SpeechEndEvent {
  id: string;
  error?: string;
  /** Stopped before its end (another reply started): what was queued stops too */
  stopped?: boolean;
}
