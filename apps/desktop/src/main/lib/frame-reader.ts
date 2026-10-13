// NDJSON framing for both ends of every socket: the sidecar client and the sidecar itself (it
// bundles this file: a change here needs a SIDECAR_VERSION bump, pty-sidecar-protocol.ts), the MCP
// server and the MCP shim and claim-guard bins.

/**
 * Default frame ceiling: a newline-less stream would otherwise grow without bound. The sidecar
 * client passes a larger one, since a ring snapshot arrives as one frame.
 */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Each chunk is scanned once and a frame is joined once. The string reader it replaced grew one
 * string per chunk and flattened it on every indexOf: a ring snapshot in 8 KB macOS socket reads
 * cost ~3s of main thread per 12 MB frame.
 */
export function createFrameReader<T>(
  onMessage: (msg: T) => void,
  onOverflow?: () => void,
  maxBytes: number = MAX_FRAME_BYTES,
): (chunk: Buffer) => void {
  let parts: Buffer[] = [];
  let held = 0;
  let discarding = false;

  const emit = (frame: Buffer) => {
    if (frame.length === 0) return;
    try {
      onMessage(JSON.parse(frame.toString("utf-8")) as T);
    } catch {
      // Malformed line: drop it, keep the connection
    }
  };

  return (chunk) => {
    let start = 0;
    let nl = chunk.indexOf(10, start);
    while (nl !== -1) {
      const end = chunk.subarray(start, nl);
      if (discarding) discarding = false;
      else emit(parts.length ? Buffer.concat([...parts, end]) : end);
      parts = [];
      held = 0;
      start = nl + 1;
      nl = chunk.indexOf(10, start);
    }
    if (start >= chunk.length || discarding) return;
    held += chunk.length - start;
    if (held > maxBytes) {
      parts = [];
      held = 0;
      discarding = true;
      onOverflow?.();
      return;
    }
    parts.push(chunk.subarray(start));
  };
}
