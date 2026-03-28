// Circular byte buffer for PTY scrollback in the sidecar.
// Stores raw ANSI output. Oldest data silently overwritten when full.

const DEFAULT_CAPACITY = 8 * 1024 * 1024; // 8MB per session

export class RingBuffer {
  private buf: Buffer;
  private head = 0; // Next write position
  private filled = false; // True once buffer has wrapped at least once

  constructor(capacity = DEFAULT_CAPACITY) {
    this.buf = Buffer.allocUnsafe(capacity);
  }

  write(data: Buffer): void {
    const len = data.length;
    if (len === 0) return;

    if (len >= this.buf.length) {
      // Data larger than buffer — keep only the tail
      data.copy(this.buf, 0, len - this.buf.length);
      this.head = 0;
      this.filled = true;
      return;
    }

    const remaining = this.buf.length - this.head;
    if (len <= remaining) {
      data.copy(this.buf, this.head);
    } else {
      // Wrap: fill end, then start
      data.copy(this.buf, this.head, 0, remaining);
      data.copy(this.buf, 0, remaining);
    }

    const newHead = (this.head + len) % this.buf.length;
    if (!this.filled && newHead < this.head) this.filled = true;
    this.head = newHead;
  }

  /** Return contents in write order (oldest → newest) */
  snapshot(): Buffer {
    if (!this.filled) {
      return Buffer.from(this.buf.subarray(0, this.head));
    }
    // Wrap: [head..end] + [0..head]
    return Buffer.concat([this.buf.subarray(this.head), this.buf.subarray(0, this.head)]);
  }

  get byteLength(): number {
    return this.filled ? this.buf.length : this.head;
  }

  clear(): void {
    this.head = 0;
    this.filled = false;
  }
}
