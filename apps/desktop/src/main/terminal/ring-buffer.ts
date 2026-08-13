// Circular byte buffer for PTY scrollback in the sidecar.
// Stores raw ANSI output. Oldest data silently overwritten when full.

const DEFAULT_CAPACITY = 8 * 1024 * 1024; // 8MB per session

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
/** Longest sequence we scan for, minus one — enough overlap that a toggle split
 *  across two writes is still seen. */
const CARRY = ALT_ON.length - 1;

export class RingBuffer {
  private buf: Buffer;
  private head = 0; // Next write position
  private filled = false; // True once buffer has wrapped at least once
  /**
   * Sticky, because the ring is not: a full-screen TUI enables the alternate
   * screen once at startup, and after 8 MB of output that sequence has been
   * evicted. Replaying the ring then rebuilds the PRIMARY screen — the shell
   * prompt from before the CLI launched — while the app draws into an alternate
   * screen the terminal never entered. That is opencode reattaching to a dead
   * shell prompt (2026-08-13).
   */
  private altScreen = false;
  private carry = "";

  constructor(capacity = DEFAULT_CAPACITY) {
    this.buf = Buffer.allocUnsafe(capacity);
  }

  /** True when the session last switched INTO the alternate screen. */
  get isAltScreen(): boolean {
    return this.altScreen;
  }

  private trackScreenMode(data: Buffer): void {
    const text = this.carry + data.toString("latin1");
    const on = text.lastIndexOf(ALT_ON);
    const off = text.lastIndexOf(ALT_OFF);
    if (on !== -1 || off !== -1) this.altScreen = on > off;
    this.carry = text.slice(-CARRY);
  }

  write(data: Buffer): void {
    const len = data.length;
    if (len === 0) return;
    this.trackScreenMode(data);

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

  /**
   * Contents in write order (oldest → newest), prefixed with the
   * alternate-screen switch when the session is in it. That switch is written
   * once at startup and is usually long evicted, so without the prefix a
   * reattaching terminal rebuilds the PRIMARY screen while the app keeps
   * drawing to the alternate one.
   */
  snapshot(): Buffer {
    const body = this.rawSnapshot();
    return this.altScreen ? Buffer.concat([Buffer.from(ALT_ON, "latin1"), body]) : body;
  }

  private rawSnapshot(): Buffer {
    if (!this.filled) {
      return Buffer.from(this.buf.subarray(0, this.head));
    }
    // Wrap: [head..end] + [0..head]
    return Buffer.concat([this.buf.subarray(this.head), this.buf.subarray(0, this.head)]);
  }

  get byteLength(): number {
    return this.filled ? this.buf.length : this.head;
  }

  /** Pre-allocated capacity (memory footprint regardless of how full the buffer is) */
  get capacity(): number {
    return this.buf.length;
  }

  clear(): void {
    this.altScreen = false;
    this.carry = "";
    this.head = 0;
    this.filled = false;
  }

  /**
   * Actually release the backing allocation (eviction). `clear()` only resets
   * pointers — the pre-allocated buffer stays resident, so evicting via clear
   * frees zero memory and the global cap becomes accounting fiction. The next
   * `write()` after `release()` regrows lazily to the original capacity.
   */
  release(): void {
    this.originalCapacity = this.buf.length;
    this.buf = Buffer.alloc(0);
    this.head = 0;
    this.filled = false;
  }

  private originalCapacity = 0;

  /** Regrow after release — call before writing again (reattach reload). */
  ensureCapacity(): void {
    if (this.buf.length === 0) {
      this.buf = Buffer.allocUnsafe(this.originalCapacity || DEFAULT_CAPACITY);
      this.head = 0;
      this.filled = false;
    }
  }
}
