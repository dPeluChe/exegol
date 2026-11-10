// The part of sherpa-onnx-node (it ships no types) the engine process uses
declare module "sherpa-onnx-node" {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }
  export interface RecognizerResult {
    text: string;
  }
  export interface OfflineStream {
    acceptWaveform(wave: Waveform): void;
  }
  export interface OfflineRecognizer {
    /** `hotwords` ("/"-separated) are added to the recognizer's own, if any */
    createStream(hotwords?: string): OfflineStream;
    decodeAsync(stream: OfflineStream): Promise<RecognizerResult>;
  }
  export const OfflineRecognizer: {
    createAsync(config: unknown): Promise<OfflineRecognizer>;
  };
  export interface OnlineStream {
    acceptWaveform(wave: Waveform): void;
    inputFinished(): void;
  }
  export interface OnlineRecognizer {
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    getResult(stream: OnlineStream): RecognizerResult;
  }
  export const OnlineRecognizer: new (config: unknown) => OnlineRecognizer;
  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }
  export interface TtsRequest {
    text: string;
    /** Speaker id in the model's voices table */
    sid: number;
    speed: number;
    /** false: samples are copied into V8 memory, which Electron requires */
    enableExternalBuffer?: boolean;
    /** Each finished chunk; returning 0 or false stops the generation */
    onProgress?: (info: {
      samples: Float32Array;
      progress: number;
    }) => number | boolean | undefined;
  }
  export interface OfflineTts {
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generateAsync(request: TtsRequest): Promise<GeneratedAudio>;
  }
  export const OfflineTts: {
    createAsync(config: unknown): Promise<OfflineTts>;
  };
}
