// T113: PTY sidecar output coalescing + overflow protection.
//
// Per-session pending buffer flushed every FLUSH_INTERVAL_MS. On overflow
// the pending buffer is discarded and replaced with ESC c + a dim notice
// so the renderer never sees a partially-emitted CSI/OSC sequence.

export const FLUSH_INTERVAL_MS = 4;
export const MAX_PENDING_BYTES = 4 * 1024 * 1024;
export const OVERFLOW_NOTICE =
  "\x1bc\x1b[2m[exegol: pty output buffer overflowed — earlier data dropped]\x1b[0m\r\n";

export interface PendingState {
  pending: string;
  pendingBytes: number;
}

export interface AppendResult extends PendingState {
  overflowed: boolean;
}

/** Pure: returns the next PendingState after appending `data`. */
export function appendPending(state: PendingState, data: string): AppendResult {
  if (data.length === 0) {
    return { pending: state.pending, pendingBytes: state.pendingBytes, overflowed: false };
  }
  if (data.length >= MAX_PENDING_BYTES) {
    const tail = data.slice(data.length - MAX_PENDING_BYTES);
    const next = OVERFLOW_NOTICE + tail;
    return { pending: next, pendingBytes: next.length, overflowed: true };
  }
  if (state.pendingBytes + data.length > MAX_PENDING_BYTES) {
    const next = OVERFLOW_NOTICE + data;
    return { pending: next, pendingBytes: next.length, overflowed: true };
  }
  return {
    pending: state.pending + data,
    pendingBytes: state.pendingBytes + data.length,
    overflowed: false,
  };
}
