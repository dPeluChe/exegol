const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * `axe stream-video --format mjpeg` writes an HTTP response head, then parts of
 * `--mjpegstream` + headers (with Content-Length) + a JPEG. Header blocks without a
 * length (the HTTP head) are skipped; a block that never ends or lies resyncs.
 */
export class MjpegParser {
  private buf: Buffer = Buffer.alloc(0);
  private need: number | null = null;

  constructor(private readonly onFrame: (jpeg: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.need !== null) {
        if (this.buf.length < this.need) return;
        const frame = this.buf.subarray(0, this.need);
        this.buf = this.buf.subarray(this.need);
        this.need = null;
        if (frame[0] === 0xff && frame[1] === 0xd8) this.onFrame(Buffer.from(frame));
        continue;
      }
      const end = this.buf.indexOf(HEADER_END);
      if (end < 0) {
        if (this.buf.length > MAX_HEADER_BYTES) this.buf = Buffer.alloc(0);
        return;
      }
      const length = contentLength(this.buf.subarray(0, end).toString("latin1"));
      this.buf = this.buf.subarray(end + HEADER_END.length);
      if (length !== null && length > 0 && length <= MAX_FRAME_BYTES) this.need = length;
    }
  }
}

export function contentLength(headers: string): number | null {
  const match = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(headers);
  return match ? Number(match[1]) : null;
}
