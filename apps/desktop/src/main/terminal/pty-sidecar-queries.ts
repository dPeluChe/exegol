// Terminal queries a shell writes to its PTY, from the sidecar's side (T184.2-3).

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
const DA1_QUERY = /\x1b\[0?c/g;
/** What xterm.js answers, so a session reads the same with or without a view attached. */
export const DA1_REPLY = "\x1b[?1;2c";

/** DA1 replies owed for this output. Only for a detached session: an attached xterm answers itself. */
export function da1Replies(data: string): string {
  if (!data.includes("\x1b[")) return "";
  return DA1_REPLY.repeat(data.match(DA1_QUERY)?.length ?? 0);
}

// DSR (status, cursor position), DA1/DA2/DA3, DECRQM mode queries, OSC 10/11/12 colour queries
const TERMINAL_QUERIES =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  /\x1b\[\??[56]n|\x1b\[[>=]?0?c|\x1b\[\??\d+\$p|\x1b\]1[0-2];\?(?:\x07|\x1b\\)/g;

/** Replay without the questions in it: a reattached xterm would answer each one into the PTY again. */
export function stripTerminalQueries(data: string): string {
  return data.includes("\x1b") ? data.replace(TERMINAL_QUERIES, "") : data;
}
