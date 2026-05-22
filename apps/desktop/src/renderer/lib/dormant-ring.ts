const DEFAULT_BYTE_CAP = 256 * 1024;
const DEFAULT_CHUNK_CAP = 256;

/**
 * ESC c hard-resets the terminal state machine; combined with the dim notice
 * it tells the user we dropped chunks rather than silently corrupt the buffer.
 */
export const DORMANT_OVERFLOW_NOTICE =
  "\x1bc\x1b[2m[exegol: dropped output while hidden]\x1b[0m\r\n";

/**
 * Bounded chunk ring used while a pane is hidden. On overflow we keep the
 * most recent tail and prepend ESC c + a dim notice so the visible state is
 * unambiguous after un-hide. Mirrors Terax dormantRing.ts.
 */
export class DormantRing {
  private chunks: string[] = [];
  private head = 0;
  private size = 0;
  private total = 0;
  private overflowed = false;

  constructor(
    private readonly byteCap: number = DEFAULT_BYTE_CAP,
    private readonly chunkCap: number = DEFAULT_CHUNK_CAP,
  ) {}

  write(chunk: string): void {
    if (chunk.length === 0) return;

    if (chunk.length >= this.byteCap) {
      this.chunks = [DORMANT_OVERFLOW_NOTICE, chunk.slice(chunk.length - this.byteCap)];
      this.head = 0;
      this.size = 2;
      this.total = DORMANT_OVERFLOW_NOTICE.length + this.byteCap;
      this.overflowed = true;
      return;
    }

    this.chunks.push(chunk);
    this.size++;
    this.total += chunk.length;

    while ((this.total > this.byteCap || this.size > this.chunkCap) && this.size > 1) {
      const droppedIdx = this.head;
      const dropped = this.chunks[droppedIdx] ?? "";
      this.chunks[droppedIdx] = "";
      this.head++;
      this.size--;
      this.total -= dropped.length;
      this.overflowed = true;
    }

    if (this.head > 1024 && this.head > this.chunks.length / 2) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  drain(): string {
    if (this.size === 0 && !this.overflowed) {
      this.reset();
      return "";
    }
    const parts: string[] = [];
    if (this.overflowed) {
      const first = this.chunks[this.head];
      if (first !== DORMANT_OVERFLOW_NOTICE) parts.push(DORMANT_OVERFLOW_NOTICE);
    }
    const end = this.head + this.size;
    for (let i = this.head; i < end; i++) {
      const c = this.chunks[i];
      if (c) parts.push(c);
    }
    this.reset();
    return parts.join("");
  }

  clear(): void {
    this.reset();
  }

  byteLength(): number {
    return this.total;
  }

  isEmpty(): boolean {
    return this.size === 0 && !this.overflowed;
  }

  didOverflow(): boolean {
    return this.overflowed;
  }

  private reset(): void {
    this.chunks = [];
    this.head = 0;
    this.size = 0;
    this.total = 0;
    this.overflowed = false;
  }
}
