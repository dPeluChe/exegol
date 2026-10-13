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

/** What one session may queue while a client is backed up; typing echo stays far below it. */
export const SESSION_BACKLOG_BYTES = 16 * 1024;

/** A session the gate paused, reported when it resumes */
export interface GatePause {
  id: string;
  /** Its bytes queued while the client was backed up */
  bytes: number;
  ms: number;
}

/** A frame this small that happens to cross the high-water mark is echo, not the flood */
export const ECHO_FRAME_BYTES = 1024;

/** Pure: a session fills the queue once its own backed-up output reaches its share, or when a
 *  frame of real size is the one that failed the write */
export function fillsQueue(backlog: number, writeFailed: boolean, frameBytes: number): boolean {
  return backlog >= SESSION_BACKLOG_BYTES || (writeFailed && frameBytes > ECHO_FRAME_BYTES);
}

/** While a client's socket is backed up, only the sessions filling it pause (the CLI blocks on
 *  its writes): pausing every PTY froze every terminal's echo during one flood */
export class OutputGate<C extends OutputClient> {
  private readonly stuck = new Set<C>();
  private readonly backlog = new Map<string, number>();
  private readonly pausedAt = new Map<string, number>();

  constructor(
    private readonly onPause: (id: string) => void,
    private readonly onResume: (pause: GatePause) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get backedUp(): boolean {
    return this.stuck.size > 0;
  }

  isPaused(id: string): boolean {
    return this.pausedAt.has(id);
  }

  /** `id`/`bytes`: the session this output belongs to; others (exit notices) are not counted */
  send(clients: Iterable<C>, msg: string, id?: string, bytes = 0): void {
    let failed = false;
    for (const client of clients) {
      let ok = true;
      try {
        ok = client.write(msg);
      } catch {
        /* dead client: its close releases it */
      }
      if (ok || this.stuck.has(client)) continue;
      failed = true;
      this.stuck.add(client);
      client.once("drain", () => this.release(client));
    }
    if (id === undefined || this.stuck.size === 0) return;
    const backlog = (this.backlog.get(id) ?? 0) + bytes;
    this.backlog.set(id, backlog);
    if (!this.pausedAt.has(id) && fillsQueue(backlog, failed, bytes)) {
      this.pausedAt.set(id, this.now());
      this.onPause(id);
    }
  }

  /** On drain, close or error */
  release(client: C): void {
    if (!this.stuck.delete(client) || this.stuck.size > 0) return;
    const now = this.now();
    const paused = [...this.pausedAt];
    this.pausedAt.clear();
    for (const [id, since] of paused) {
      this.onResume({ id, bytes: this.backlog.get(id) ?? 0, ms: now - since });
    }
    this.backlog.clear();
  }

  /** The session ended: nothing to resume */
  forget(id: string): void {
    this.pausedAt.delete(id);
    this.backlog.delete(id);
  }
}
