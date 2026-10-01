// T113: PTY sidecar output coalescing + overflow protection.
//
// Per-session pending buffer flushed every FLUSH_INTERVAL_MS. On overflow
// the pending buffer is discarded and replaced with ESC c + a dim notice
// so the renderer never sees a partially-emitted CSI/OSC sequence.

export const FLUSH_INTERVAL_MS = 4;
export const MAX_PENDING_BYTES = 4 * 1024 * 1024;
export const OVERFLOW_NOTICE =
  "\x1bc\x1b[2m[exegol: pty output buffer overflowed — earlier data dropped]\x1b[0m\r\n";

interface PendingState {
  pending: string;
  pendingBytes: number;
}

interface AppendResult extends PendingState {
  overflowed: boolean;
}

const OVERFLOW_NOTICE_BYTES = Buffer.byteLength(OVERFLOW_NOTICE, "utf-8");

/** The last `max` bytes of UTF-8 `buf`, starting on a character boundary. */
export function utf8Tail(buf: Buffer, max: number): Buffer {
  let start = Math.max(0, buf.length - max);
  while (start < buf.length && ((buf[start] as number) & 0xc0) === 0x80) start++;
  return buf.subarray(start);
}

/** Pure: returns the next PendingState after appending `data` (`bytes`: its UTF-8 length). */
export function appendPending(
  state: PendingState,
  data: string,
  bytes = Buffer.byteLength(data, "utf-8"),
): AppendResult {
  if (bytes === 0) {
    return { pending: state.pending, pendingBytes: state.pendingBytes, overflowed: false };
  }
  if (bytes >= MAX_PENDING_BYTES) {
    const tail = utf8Tail(Buffer.from(data, "utf-8"), MAX_PENDING_BYTES);
    return {
      pending: OVERFLOW_NOTICE + tail.toString("utf-8"),
      pendingBytes: OVERFLOW_NOTICE_BYTES + tail.length,
      overflowed: true,
    };
  }
  if (state.pendingBytes + bytes > MAX_PENDING_BYTES) {
    return {
      pending: OVERFLOW_NOTICE + data,
      pendingBytes: OVERFLOW_NOTICE_BYTES + bytes,
      overflowed: true,
    };
  }
  return {
    pending: state.pending + data,
    pendingBytes: state.pendingBytes + bytes,
    overflowed: false,
  };
}

interface OutputClient {
  write(data: string): boolean;
  once(event: "drain", listener: () => void): unknown;
}

/**
 * Flow control for the sidecar's clients: while one has a full socket queue, the PTYs pause
 * (the CLI blocks on its own writes) instead of the queue growing without bound.
 */
export class OutputGate<C extends OutputClient> {
  private readonly stuck = new Set<C>();

  constructor(private readonly onPausedChange: (paused: boolean) => void) {}

  get paused(): boolean {
    return this.stuck.size > 0;
  }

  send(clients: Iterable<C>, msg: string): void {
    for (const client of clients) {
      let ok = true;
      try {
        ok = client.write(msg);
      } catch {
        /* dead client: its close releases it */
      }
      if (ok || this.stuck.has(client)) continue;
      this.stuck.add(client);
      if (this.stuck.size === 1) this.onPausedChange(true);
      client.once("drain", () => this.release(client));
    }
  }

  /** On drain, close or error */
  release(client: C): void {
    if (this.stuck.delete(client) && this.stuck.size === 0) this.onPausedChange(false);
  }
}
