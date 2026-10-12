// Sticky DEC private modes for the sidecar's ring: a TUI sets them once at startup, and a wrapped
// ring or a capped replay has lost those sequences (bracketed paste, mouse, hidden cursor, alt).

const DEC_PREFIX = Buffer.from("\x1b[?", "latin1");
const RIS = Buffer.from("\x1bc", "latin1");
const DECSTR = Buffer.from("\x1b[!p", "latin1");
const ALT_MODES = new Set([47, 1047, 1049]);
/** Cursor keys, cursor visibility, mouse protocols, focus events, bracketed paste */
const TRACKED = new Set([1, 25, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004]);
/** A parameter list longer than this is no mode switch we track */
const MAX_SEQ = 32;
const H = 0x68;
const L = 0x6c;

type Kind = "dec" | "ris" | "str";
const PATTERNS: Record<Kind, Buffer> = { dec: DEC_PREFIX, ris: RIS, str: DECSTR };
const KINDS = ["dec", "ris", "str"] as const;

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
    const carry = this.carry;
    this.carry = null;
    // Only the seam is joined: sequences that began in the carry, then the chunk on its own
    if (carry) this.scan(Buffer.concat([carry, chunk.subarray(0, MAX_SEQ)]), carry.length, false);
    this.scan(chunk, Number.POSITIVE_INFINITY, true);
  }

  /** Applies switches starting before `stopAt`, in order; `keepCarry` holds a cut one back */
  private scan(data: Buffer, stopAt: number, keepCarry: boolean): void {
    const next = { dec: -1, ris: -1, str: -1 };
    for (const k of KINDS) next[k] = data.indexOf(PATTERNS[k]);
    for (;;) {
      let kind: Kind | null = null;
      for (const k of KINDS) {
        if (next[k] !== -1 && (kind === null || next[k] < next[kind])) kind = k;
      }
      if (kind === null || next[kind] >= stopAt) break;
      const at = next[kind];
      let end: number;
      if (kind === "dec") {
        end = this.parse(data, at + DEC_PREFIX.length);
        if (end === -1) {
          if (keepCarry && data.length - at <= MAX_SEQ) this.carry = Buffer.from(data.subarray(at));
          return;
        }
      } else if (kind === "ris") {
        this.alt = false;
        this.modes.clear();
        end = at + RIS.length;
      } else {
        this.modes.delete(1);
        this.modes.delete(25);
        end = at + DECSTR.length;
      }
      for (const k of KINDS)
        if (next[k] !== -1 && next[k] < end) next[k] = data.indexOf(PATTERNS[k], end);
    }
    if (!keepCarry) return;
    // A switch cut right after its ESC, `[` or `!`
    const tail = data.subarray(Math.max(0, data.length - 3));
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
