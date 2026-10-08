/**
 * NDJSON framing for the sidecar socket, on the main side only. lib/ndjson grew one string per
 * chunk and its indexOf flattened it each time: a ring snapshot arrives in 8 KB chunks on macOS,
 * so 12 MB of JSON cost ~3s of main thread per session. Here each chunk is scanned once and a
 * frame is joined once. lib/ndjson stays as is because the sidecar bundles it.
 */
export function createFrameBuffer<T>(
  onMessage: (msg: T) => void,
  onOverflow: () => void,
  maxBytes: number,
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
      onOverflow();
      return;
    }
    parts.push(chunk.subarray(start));
  };
}
