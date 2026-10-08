/**
 * Streaming resampler for mic audio to the 16 kHz the speech models take. Down: each output
 * sample averages the input samples it covers (a box filter, enough against aliasing for speech).
 * Up (an 8 kHz headset): linear interpolation. Chunked input gives the same output as one block.
 */
export class StreamResampler {
  private readonly ratio: number;
  /** Absolute index of buf[0] in the input stream */
  private start = 0;
  /** Absolute index of the next output sample */
  private next = 0;
  private buf = new Float32Array(0);

  constructor(inRate: number, outRate: number) {
    if (!(inRate > 0 && outRate > 0)) throw new Error("bad sample rate");
    this.ratio = inRate / outRate;
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    const end = this.start + merged.length;
    const out: number[] = [];
    const r = this.ratio;
    if (r > 1) {
      while (Math.floor((this.next + 1) * r) <= end) {
        const from = Math.floor(this.next * r);
        const to = Math.max(from + 1, Math.floor((this.next + 1) * r));
        let sum = 0;
        for (let i = from; i < to; i++) sum += merged[i - this.start] ?? 0;
        out.push(sum / (to - from));
        this.next++;
      }
    } else {
      while (Math.floor(this.next * r) + 1 < end) {
        const x = this.next * r;
        const i = Math.floor(x);
        const a = merged[i - this.start] ?? 0;
        const b = merged[i + 1 - this.start] ?? 0;
        out.push(a + (b - a) * (x - i));
        this.next++;
      }
    }
    const keepFrom = Math.min(Math.floor(this.next * r), end);
    this.buf = merged.slice(keepFrom - this.start);
    this.start = keepFrom;
    return Float32Array.from(out);
  }
}
