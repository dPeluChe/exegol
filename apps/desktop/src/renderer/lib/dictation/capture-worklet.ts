// AudioWorklet: the mic's first channel, resampled to 16 kHz, posted in ~100 ms chunks
import { StreamResampler } from "./resampler";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const TARGET_RATE = 16_000;
const CHUNK = 1_600;

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new StreamResampler(sampleRate, TARGET_RATE);
  private pending: Float32Array[] = [];
  private size = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const out = this.resampler.push(channel);
    if (out.length > 0) {
      this.pending.push(out);
      this.size += out.length;
    }
    if (this.size >= CHUNK) {
      const chunk = new Float32Array(this.size);
      let offset = 0;
      for (const part of this.pending) {
        chunk.set(part, offset);
        offset += part.length;
      }
      this.pending = [];
      this.size = 0;
      this.port.postMessage(chunk, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor("exegol-capture", CaptureProcessor);
