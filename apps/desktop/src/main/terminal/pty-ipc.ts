// Binary framing protocol for PTY subprocess IPC.
// Header: type (u8) + payload length (u32 LE) = 5 bytes total.

export const HEADER_SIZE = 5;
export const MAX_FRAME_SIZE = 64 * 1024 * 1024; // 64MB

// Main -> Subprocess
export const FRAME_SPAWN = 0;
export const FRAME_WRITE = 1;
export const FRAME_RESIZE = 2;
export const FRAME_KILL = 3;
export const FRAME_DISPOSE = 4;

// Subprocess -> Main
export const FRAME_READY = 10;
export const FRAME_SPAWNED = 11;
export const FRAME_DATA = 12;
export const FRAME_EXIT = 13;
export const FRAME_ERROR = 14;

export interface SpawnPayload {
  shell: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
}

export interface ResizePayload {
  cols: number;
  rows: number;
}

export interface SpawnedPayload {
  pid: number;
}

export interface ExitPayload {
  exitCode: number;
  signal?: number;
}

export function encodeFrame(type: number, payload: Buffer): Buffer {
  if (payload.length > MAX_FRAME_SIZE) {
    throw new Error(`Frame payload exceeds 64MB limit: ${payload.length}`);
  }
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt8(type, 0);
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export function encodeString(type: number, data: string): Buffer {
  return encodeFrame(type, Buffer.from(data, "utf-8"));
}

export function encodeJson(type: number, obj: unknown): Buffer {
  return encodeString(type, JSON.stringify(obj));
}

/**
 * Streaming frame decoder. Accumulates partial frames and yields complete ones.
 */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  decode(chunk: Buffer): Array<{ type: number; payload: Buffer }> {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;

    if (this.totalLength < HEADER_SIZE) return [];

    let buffer =
      this.chunks.length === 1 && this.chunks[0] ? this.chunks[0] : Buffer.concat(this.chunks);
    this.chunks = [];
    this.totalLength = 0;

    const frames: Array<{ type: number; payload: Buffer }> = [];

    while (buffer.length >= HEADER_SIZE) {
      const type = buffer.readUInt8(0);
      const length = buffer.readUInt32LE(1);

      if (length > MAX_FRAME_SIZE) {
        buffer = Buffer.alloc(0);
        break;
      }

      const total = HEADER_SIZE + length;
      if (buffer.length < total) break;

      frames.push({ type, payload: buffer.subarray(HEADER_SIZE, total) });
      buffer = buffer.subarray(total);
    }

    if (buffer.length > 0) {
      this.chunks.push(buffer);
      this.totalLength = buffer.length;
    }

    return frames;
  }
}
