import { open } from "node:fs/promises";

/** Enough for a transcript's metadata preamble without reading a 35 MB file. */
const HEAD_BYTES = 64 * 1024;

/** First `HEAD_BYTES` of a file as UTF-8. The final line is usually truncated —
 *  callers parse line by line and tolerate the tail failing. */
export async function readHead(path: string, bytes = HEAD_BYTES): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    await handle.close();
  }
}
