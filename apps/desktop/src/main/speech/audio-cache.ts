import { createHash } from "node:crypto";

export interface AudioChunk {
  samples: Float32Array;
  sampleRate: number;
}

/** ~8 minutes of 24 kHz mono: the newest replies, in memory only */
export const CACHE_MAX_BYTES = 48 * 1024 * 1024;

const clips = new Map<string, AudioChunk[]>();
let held = 0;

const bytesOf = (chunks: AudioChunk[]) => chunks.reduce((n, c) => n + c.samples.byteLength, 0);

/** The same words in the same voice at the same speed sound the same */
export function clipKey(sentences: string[], voiceId: string, speed: number): string {
  return createHash("sha256")
    .update(JSON.stringify([voiceId, speed, sentences]))
    .digest("hex");
}

export function getClip(key: string): AudioChunk[] | undefined {
  const clip = clips.get(key);
  if (!clip) return undefined;
  // Read again: the last one to go
  clips.delete(key);
  clips.set(key, clip);
  return clip;
}

export function putClip(key: string, chunks: AudioChunk[], maxBytes = CACHE_MAX_BYTES): void {
  const size = bytesOf(chunks);
  if (size === 0 || size > maxBytes) return;
  const old = clips.get(key);
  if (old) {
    held -= bytesOf(old);
    clips.delete(key);
  }
  clips.set(key, chunks);
  held += size;
  for (const [oldest, clip] of clips) {
    if (held <= maxBytes) break;
    clips.delete(oldest);
    held -= bytesOf(clip);
  }
}

export function clearClips(): void {
  clips.clear();
  held = 0;
}
