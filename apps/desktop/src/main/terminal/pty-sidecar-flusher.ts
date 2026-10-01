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

/** The last `max` UTF-8 bytes of `data`, starting on a character boundary. */
function utf8Tail(data: string, max: number): string {
  const buf = Buffer.from(data, "utf-8");
  let start = buf.length - max;
  while (start < buf.length && ((buf[start] as number) & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString("utf-8");
}

/** Pure: returns the next PendingState after appending `data`. Counted in UTF-8 bytes. */
export function appendPending(state: PendingState, data: string): AppendResult {
  if (data.length === 0) {
    return { pending: state.pending, pendingBytes: state.pendingBytes, overflowed: false };
  }
  const bytes = Buffer.byteLength(data, "utf-8");
  if (bytes >= MAX_PENDING_BYTES) {
    const next = OVERFLOW_NOTICE + utf8Tail(data, MAX_PENDING_BYTES);
    return { pending: next, pendingBytes: Buffer.byteLength(next, "utf-8"), overflowed: true };
  }
  if (state.pendingBytes + bytes > MAX_PENDING_BYTES) {
    const next = OVERFLOW_NOTICE + data;
    return { pending: next, pendingBytes: Buffer.byteLength(next, "utf-8"), overflowed: true };
  }
  return {
    pending: state.pending + data,
    pendingBytes: state.pendingBytes + bytes,
    overflowed: false,
  };
}

/** A client this far behind is not reading: past it, its socket queue would grow without bound. */
export const MAX_CLIENT_BACKLOG_BYTES = 64 * 1024 * 1024;

interface BroadcastClient {
  readonly writableLength: number;
  write(data: string): boolean;
  destroy(): void;
}

/** Write `msg` to every client; a client whose unread backlog is over the cap is dropped. */
export function broadcastTo<C extends BroadcastClient>(
  clients: Set<C>,
  msg: string,
  onDrop: (backlogBytes: number) => void,
  maxBacklog = MAX_CLIENT_BACKLOG_BYTES,
): void {
  for (const client of clients) {
    if (client.writableLength > maxBacklog) {
      clients.delete(client);
      onDrop(client.writableLength);
      client.destroy();
      continue;
    }
    try {
      client.write(msg);
    } catch {
      /* dead client */
    }
  }
}
