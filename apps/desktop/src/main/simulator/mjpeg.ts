const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const EMPTY = Buffer.alloc(0);

/**
 * `axe stream-video --format mjpeg` writes an HTTP response head, then parts of
 * `--mjpegstream` + headers (with Content-Length) + a JPEG. Header blocks without a
 * length (the HTTP head) are skipped; a block that never ends or lies resyncs.
 */
export class MjpegParser {
  /** Unparsed header bytes, bounded by MAX_HEADER_BYTES */
  private head: Buffer = EMPTY;
  /** The body being filled, copied into once: no concat per chunk */
  private body: Buffer | null = null;
  private filled = 0;

  constructor(private readonly onFrame: (jpeg: Buffer) => void) {}

  push(chunk: Buffer): void {
    let rest = chunk;
    while (rest.length) {
      if (this.body) {
        const take = Math.min(rest.length, this.body.length - this.filled);
        rest.copy(this.body, this.filled, 0, take);
        this.filled += take;
        rest = rest.subarray(take);
        if (this.filled < this.body.length) return;
        const frame = this.body;
        this.body = null;
        // Not a JPEG (a PNG at scale 1, a torn part): skipped, the stream goes on
        if (frame[0] === 0xff && frame[1] === 0xd8) this.onFrame(frame);
        continue;
      }
      const buf = this.head.length ? Buffer.concat([this.head, rest]) : rest;
      const end = buf.indexOf(HEADER_END);
      if (end < 0) {
        this.head = buf.length > MAX_HEADER_BYTES ? EMPTY : Buffer.from(buf);
        return;
      }
      this.head = EMPTY;
      const length = contentLength(buf.subarray(0, end).toString("latin1"));
      rest = buf.subarray(end + HEADER_END.length);
      if (length !== null && length > 0 && length <= MAX_FRAME_BYTES) {
        this.body = Buffer.allocUnsafe(length);
        this.filled = 0;
      }
    }
  }
}

export function contentLength(headers: string): number | null {
  const match = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(headers);
  return match ? Number(match[1]) : null;
}
