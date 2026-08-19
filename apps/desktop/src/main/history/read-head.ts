import { open } from "node:fs/promises";

/**
 * Enough for a transcript's metadata preamble without reading a 35 MB file.
 * Sized by the worst case measured in the wild: codex writes the model's full
 * `base_instructions` into its FIRST line, 15-22 KB of it.
 */
const HEAD_BYTES = 64 * 1024;

export interface FileHead {
  /** First `HEAD_BYTES` as UTF-8. The final line is usually truncated — callers
   *  parse line by line and tolerate the tail failing. */
  head: string;
  sizeBytes: number;
  /** Epoch seconds; the only end-time these append-only stores offer. */
  modifiedAt: number;
}

/** One open per file: the head and the stat come from the same handle, instead
 *  of a separate `stat(path)` paying a second path resolution and open. */
export async function readHead(path: string): Promise<FileHead> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    // allocUnsafe, not alloc: 64 KB is past Buffer.poolSize, so `alloc` memsets
    // a fresh block per file — 48 MB zeroed across a full codex scan. The
    // subarray below bounds what is read out.
    const buffer = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return {
      head: buffer.subarray(0, bytesRead).toString("utf-8"),
      sizeBytes: info.size,
      modifiedAt: Math.floor(info.mtimeMs / 1000),
    };
  } finally {
    await handle.close();
  }
}
