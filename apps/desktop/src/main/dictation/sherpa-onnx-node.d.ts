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
    createStream(): OfflineStream;
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
}
