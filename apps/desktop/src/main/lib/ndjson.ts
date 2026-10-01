// NDJSON framing shared by the MCP socket and the PTY sidecar. The sidecar bundles this file:
// a change here needs a SIDECAR_VERSION bump (pty-sidecar-protocol.ts).

import { StringDecoder } from "node:string_decoder";

/**
 * Default frame ceiling: a newline-less stream would grow the buffer without
 * bound, and in the main process that is the whole app. Counted in UTF-16 chars.
 *
 * This is the ceiling for the MCP socket, where the largest message is a tool
 * result and agent_send caps its body far below. It is NOT one size for every
 * channel — `createNdjsonBuffer` takes an override, because the PTY sidecar
 * socket carries a whole ring buffer in one frame and JSON escaping inflates
 * `\x1b` to `\u001b`, six chars per byte.
 */
export const MAX_NDJSON_LINE_CHARS = 8 * 1024 * 1024;

/**
 * Buffers arbitrary chunks and yields complete newline-delimited JSON messages.
 * Shared by the server and both bin scripts so socket framing stays in one place.
 */
export function createNdjsonBuffer<T>(
  onMessage: (msg: T) => void,
  onOverflow?: () => void,
  maxChars: number = MAX_NDJSON_LINE_CHARS,
): (chunk: Buffer | string) => void {
  // StringDecoder, not per-chunk toString: a multibyte character split across
  // a chunk boundary would otherwise decode to U+FFFD on both sides and the
  // message would fail to parse (tool results carry user prose — acentos).
  const decoder = new StringDecoder("utf-8");
  let buffer = "";
  // What was already scanned holds no newline: a big frame in 64 KB chunks
  // would otherwise be rescanned from 0 on every chunk (quadratic)
  let searchFrom = 0;
  let overflowed = false;
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (buffer.length > maxChars) {
      // Drop what we hold and stay in the discard state until a newline gives
      // us a fresh frame boundary — resuming mid-message would parse garbage.
      const resumeAt = buffer.lastIndexOf("\n");
      buffer = resumeAt === -1 ? "" : buffer.slice(resumeAt + 1);
      searchFrom = 0;
      if (!overflowed) {
        overflowed = true;
        onOverflow?.();
      }
    }
    let start = 0;
    let newlineIdx = buffer.indexOf("\n", searchFrom);
    while (newlineIdx !== -1) {
      const line = buffer.slice(start, newlineIdx);
      start = newlineIdx + 1;
      // A newline IS the framing recovering — independent of whether this
      // particular line parses, or of what the handler does with it.
      overflowed = false;
      if (line.trim().length > 0) {
        try {
          onMessage(JSON.parse(line) as T);
        } catch {
          // Malformed line — drop it, don't crash the connection.
        }
      }
      newlineIdx = buffer.indexOf("\n", start);
    }
    if (start > 0) buffer = buffer.slice(start);
    searchFrom = buffer.length;
  };
}
