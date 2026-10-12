// Sticky DEC private modes for the sidecar's ring: a TUI sets them once at startup, and once the
// ring wraps (or a reattach replays only its tail) those sequences are gone. Replaying without
// them loses bracketed paste, mouse tracking, the hidden cursor and the alternate screen.

const DEC_PREFIX = Buffer.from("\x1b[?", "latin1");
const ALT_MODES = new Set([47, 1047, 1049]);
/** Cursor keys, cursor visibility, mouse protocols, focus events, bracketed paste */
const TRACKED = new Set([1, 25, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004]);
/** A parameter list longer than this is no mode switch we track */
const MAX_SEQ = 32;
const H = 0x68;
const L = 0x6c;

export class ModeTracker {
  private alt = false;
  private readonly modes = new Map<number, boolean>();
  private carry: Buffer | null = null;

  get altScreen(): boolean {
    return this.alt;
  }

  /** The switches that rebuild the current modes, the alternate screen first */
  prefix(): string {
    let out = this.alt ? "\x1b[?1049h" : "";
    for (const [mode, on] of this.modes) out += `\x1b[?${mode}${on ? "h" : "l"}`;
    return out;
  }

  write(chunk: Buffer): void {
    const data = this.carry ? Buffer.concat([this.carry, chunk]) : chunk;
    this.carry = null;
    let i = data.indexOf(DEC_PREFIX);
    while (i !== -1) {
      const end = this.parse(data, i + DEC_PREFIX.length);
      if (end === -1) {
        // Cut mid-sequence: the rest arrives with the next write
        if (data.length - i <= MAX_SEQ) this.carry = Buffer.from(data.subarray(i));
        return;
      }
      i = data.indexOf(DEC_PREFIX, end);
    }
    // A prefix split right after its ESC or `[`
    const tail = data.length >= 2 ? data.subarray(data.length - 2) : data;
    const esc = tail.lastIndexOf(0x1b);
    if (esc !== -1) this.carry = Buffer.from(tail.subarray(esc));
  }

  /** Applies one `?Pm h|l` at `from`; returns where it ended, or -1 when the data stops first */
  private parse(data: Buffer, from: number): number {
    const params: number[] = [];
    let n = 0;
    let digits = false;
    for (let j = from; j < data.length; j++) {
      const c = data[j] as number;
      if (c >= 0x30 && c <= 0x39) {
        n = n * 10 + (c - 0x30);
        digits = true;
      } else if (c === 0x3b) {
        params.push(n);
        n = 0;
        digits = false;
      } else {
        if (digits) params.push(n);
        if (c === H || c === L) this.apply(params, c === H);
        return j + 1;
      }
      if (j - from > MAX_SEQ) return j;
    }
    return -1;
  }

  private apply(params: number[], on: boolean): void {
    for (const p of params) {
      if (ALT_MODES.has(p)) this.alt = on;
      else if (TRACKED.has(p)) this.modes.set(p, on);
    }
  }
}
