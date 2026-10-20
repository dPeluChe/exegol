// Circular byte buffer for PTY scrollback in the sidecar.
// Stores raw ANSI output. Oldest data silently overwritten when full.

import { ModeTracker } from "./terminal-modes";

const DEFAULT_CAPACITY = 8 * 1024 * 1024; // 8MB per session

/** A capped snapshot starts at a line break or ESC this close to its cut, never mid-sequence */
const ALIGN_BYTES = 4096;
/** A reset, or erase screen + scrollback: nothing written before it is visible after */
const CLEAR_POINTS = [Buffer.from("\x1bc", "latin1"), Buffer.from("\x1b[2J\x1b[3J", "latin1")];

/** Pure: how many leading bytes are UTF-8 continuation bytes (a character cut by the wrap) */
export function continuationBytes(buf: Buffer): number {
  let n = 0;
  while (n < 3 && n < buf.length && ((buf[n] as number) & 0xc0) === 0x80) n++;
  return n;
}

/** Pure: where a capped tail starts: the last clear, else the first line start or ESC near the
 *  cut, whichever comes first, else the first whole character */
export function tailStart(tail: Buffer): number {
  let clear = -1;
  for (const point of CLEAR_POINTS) clear = Math.max(clear, tail.lastIndexOf(point));
  if (clear !== -1) return clear;
  const window = tail.subarray(0, ALIGN_BYTES);
  const nl = window.indexOf(0x0a);
  const esc = window.indexOf(0x1b);
  const starts = [nl === -1 ? -1 : nl + 1, esc].filter((i) => i !== -1);
  return starts.length > 0 ? Math.min(...starts) : continuationBytes(tail);
}

export class RingBuffer {
  private buf: Buffer;
  private head = 0; // Next write position
  private filled = false; // True once buffer has wrapped at least once
  /** Sticky, because the ring is not: a TUI sets its modes once at startup and the ring evicts
   *  them (opencode reattached to a dead shell prompt, 2026-08-13) */
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

  /** Contents oldest first behind the current modes (a reload from disk lost the start). A
   *  capped one keeps the tail from a clean start. One copy */
  snapshot(maxBytes?: number): Buffer {
    const prefix = Buffer.from(this.modes.prefix(), "latin1");
    let parts = this.parts();
    const capped = maxBytes !== undefined && byteSum(parts) > maxBytes;
    if (capped) parts = tailParts(parts, maxBytes);
    const out = Buffer.concat([prefix, ...parts]);
    const body = out.subarray(prefix.length);
    const start = capped ? tailStart(body) : this.filled ? continuationBytes(body) : 0;
    if (start === 0) return out;
    // Slide the prefix up to the start instead of copying the body again
    out.copy(out, start, 0, prefix.length);
    return out.subarray(start);
  }

  /** Without the mode prefix: eviction persists this and reloads it through write(), so a
   *  prefixed copy would accrete one forged escape per cycle */
  rawSnapshot(): Buffer {
    const whole = Buffer.concat(this.parts());
    return this.filled ? whole.subarray(continuationBytes(whole)) : whole;
  }

  /** Contents in write order, without copying: callers concat once. */
  private parts(): Buffer[] {
    if (!this.filled) return [this.buf.subarray(0, this.head)];
    return [this.buf.subarray(this.head), this.buf.subarray(0, this.head)];
  }

  /** Memory pressure: keep the newest `bytes` in a smaller allocation. Returns the bytes freed */
  shrinkTo(bytes: number): number {
    const before = this.buf.length;
    if (bytes >= before) return 0;
    const tail = tailParts(this.parts(), bytes);
    let skip = continuationBytes(Buffer.concat(tail.map((p) => p.subarray(0, 3))));
    const next = Buffer.allocUnsafe(bytes);
    let kept = 0;
    for (const p of tail) {
      const from = Math.min(skip, p.length);
      skip -= from;
      kept += p.copy(next, kept, from);
    }
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

function byteSum(parts: Buffer[]): number {
  return parts.reduce((n, p) => n + p.length, 0);
}

/** The last `max` bytes across `parts`, as views */
function tailParts(parts: Buffer[], max: number): Buffer[] {
  const out: Buffer[] = [];
  let need = max;
  for (let i = parts.length - 1; i >= 0 && need > 0; i--) {
    const p = parts[i] as Buffer;
    const take = Math.min(need, p.length);
    out.unshift(p.subarray(p.length - take));
    need -= take;
  }
  return out;
}
