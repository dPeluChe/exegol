// Circular byte buffer for PTY scrollback in the sidecar.
// Stores raw ANSI output. Oldest data silently overwritten when full.

import { ModeTracker } from "./terminal-modes";

const DEFAULT_CAPACITY = 8 * 1024 * 1024; // 8MB per session

/** A capped snapshot starts at the first line break this close to its cut, not mid-sequence */
const LINE_ALIGN_BYTES = 4096;
/** A reset, or erase screen + scrollback: nothing written before it is visible after */
const CLEAR_POINTS = [Buffer.from("\x1bc", "latin1"), Buffer.from("\x1b[2J\x1b[3J", "latin1")];

/** Pure: how many leading bytes are UTF-8 continuation bytes (a character cut by the wrap) */
export function continuationBytes(buf: Buffer): number {
  let n = 0;
  while (n < 3 && n < buf.length && ((buf[n] as number) & 0xc0) === 0x80) n++;
  return n;
}

/** Pure: where a capped tail should start: the last clear, else the first line break near the cut */
export function tailStart(tail: Buffer): number {
  let clear = -1;
  for (const point of CLEAR_POINTS) clear = Math.max(clear, tail.lastIndexOf(point));
  if (clear !== -1) return clear;
  const nl = tail.indexOf(0x0a);
  return nl !== -1 && nl < LINE_ALIGN_BYTES ? nl + 1 : continuationBytes(tail);
}

export class RingBuffer {
  private buf: Buffer;
  private head = 0; // Next write position
  private filled = false; // True once buffer has wrapped at least once
  /**
   * Sticky, because the ring is not: a full-screen TUI enables the alternate screen (and bracketed
   * paste, mouse modes) once at startup, and after 8 MB of output those sequences are evicted.
   * Replaying the ring then rebuilt the PRIMARY screen: opencode reattached to a dead shell prompt
   * (2026-08-13).
   */
  private readonly modes = new ModeTracker();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.buf = Buffer.allocUnsafe(capacity);
  }

  /** True when the session last switched INTO the alternate screen. */
  get isAltScreen(): boolean {
    return this.modes.altScreen;
  }

  write(data: Buffer): void {
    const len = data.length;
    if (len === 0) return;
    this.modes.write(data);

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
   * Contents in write order (oldest to newest), prefixed with the modes the session is in (the
   * alternate screen first). A capped snapshot starts at the last clear, else at a line break near the cut.
   */
  snapshot(maxBytes?: number): Buffer {
    const parts = this.parts();
    const total = parts.reduce((n, p) => n + p.length, 0);
    let body: Buffer;
    if (maxBytes !== undefined && total > maxBytes) {
      const tail = concatTail(parts, maxBytes);
      body = tail.subarray(tailStart(tail));
    } else {
      body = this.rawSnapshot();
    }
    // Always: content replayed after it ends on the same modes, and a reload from disk lost the start
    const prefix = this.modes.prefix();
    return prefix ? Buffer.concat([Buffer.from(prefix, "latin1"), body]) : body;
  }

  /**
   * Contents WITHOUT the mode prefix. Persistence must use this: eviction writes the snapshot to
   * disk and reload feeds it back through `write()`, so a prefixed snapshot would be stored as
   * real content and prefixed again on the next read. Starts on a character boundary.
   */
  rawSnapshot(): Buffer {
    const parts = this.parts();
    const whole = parts.length === 1 ? Buffer.from(parts[0] as Buffer) : Buffer.concat(parts);
    return this.filled ? whole.subarray(continuationBytes(whole)) : whole;
  }

  /** Contents in write order, without copying: callers concat once. */
  private parts(): Buffer[] {
    if (!this.filled) return [this.buf.subarray(0, this.head)];
    return [this.buf.subarray(this.head), this.buf.subarray(0, this.head)];
  }

  /**
   * Memory pressure: keep only the newest `bytes` in a smaller allocation (the capacity shrinks
   * with it). Returns the capacity freed.
   */
  shrinkTo(bytes: number): number {
    const before = this.buf.length;
    if (bytes >= before) return 0;
    const tail = concatTail(this.parts(), bytes);
    const start = continuationBytes(tail);
    const next = Buffer.allocUnsafe(bytes);
    const kept = tail.copy(next, 0, start);
    this.buf = next;
    this.head = kept % bytes;
    this.filled = kept === bytes;
    return before - bytes;
  }

  get byteLength(): number {
    return this.filled ? this.buf.length : this.head;
  }

  /** Pre-allocated capacity (memory footprint regardless of how full the buffer is) */
  get capacity(): number {
    return this.buf.length;
  }

  /** Keeps the screen mode: a cleared TUI is still on the alternate screen, and its replay must say so. */
  clear(): void {
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

/** The last `max` bytes across `parts`, in one buffer */
function concatTail(parts: Buffer[], max: number): Buffer {
  const out: Buffer[] = [];
  let need = max;
  for (let i = parts.length - 1; i >= 0 && need > 0; i--) {
    const p = parts[i] as Buffer;
    const take = Math.min(need, p.length);
    out.unshift(p.subarray(p.length - take));
    need -= take;
  }
  return Buffer.concat(out);
}
