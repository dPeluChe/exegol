import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal; redirect: "follow" },
) => Promise<Response>;

export interface DownloadOptions {
  url: string;
  dest: string;
  expectedBytes: number;
  sha256: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onVerifying?: () => void;
}

export class DownloadError extends Error {}
class OversizeError extends DownloadError {}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Downloads into `dest`, resuming a partial file with an HTTP Range request,
 * then checks size and sha256. A mismatch deletes the file: a bad partial must
 * not be resumed again.
 */
export async function downloadVerified(opts: DownloadOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike);
  let start = await fileSize(opts.dest);
  if (start > opts.expectedBytes) {
    await rm(opts.dest, { force: true });
    start = 0;
  }

  if (start < opts.expectedBytes) {
    const headers: Record<string, string> = start > 0 ? { Range: `bytes=${start}-` } : {};
    const res = await fetchImpl(opts.url, { headers, signal: opts.signal, redirect: "follow" });
    const finalUrl = res.url || opts.url;
    if (!finalUrl.startsWith("https://")) {
      throw new DownloadError("refused: the download was redirected off https");
    }
    if (res.status === 416) {
      // Server says the range is past the end: what we hold is the whole file, or garbage
    } else if (res.status !== 200 && res.status !== 206) {
      throw new DownloadError(`HTTP ${res.status}`);
    } else {
      // A 200 to a range request means the server ignored it: start over
      const append = res.status === 206 && start > 0;
      if (!append) start = 0;
      if (!res.body) throw new DownloadError("empty response");
      let received = start;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length;
          if (received > opts.expectedBytes) {
            done(new OversizeError(`size mismatch: more than ${opts.expectedBytes} bytes`));
            return;
          }
          opts.onProgress?.(received, opts.expectedBytes);
          done(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(res.body as unknown as WebReadableStream),
          counter,
          createWriteStream(opts.dest, { flags: append ? "a" : "w" }),
          { signal: opts.signal },
        );
      } catch (err) {
        if (err instanceof OversizeError) await rm(opts.dest, { force: true });
        throw err;
      }
    }
  }

  const size = await fileSize(opts.dest);
  if (size < opts.expectedBytes) {
    throw new DownloadError(`connection closed at ${size} of ${opts.expectedBytes} bytes`);
  }
  if (size > opts.expectedBytes) {
    await rm(opts.dest, { force: true });
    throw new DownloadError(`size mismatch: got ${size}, expected ${opts.expectedBytes}`);
  }
  opts.onVerifying?.();
  const digest = await sha256File(opts.dest);
  if (digest !== opts.sha256) {
    await rm(opts.dest, { force: true });
    throw new DownloadError("sha256 mismatch: the download was corrupted or replaced");
  }
}
