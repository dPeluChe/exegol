/**
 * xterm answers terminal queries (cursor position, device attributes, colours,
 * mode reports) by emitting the reply through onData, exactly like a keystroke.
 * The pane that owns the session already answers them, so a mirror forwarding
 * its own copy would type every reply into the agent a second time, and replay
 * old queries from the snapshot on mount. None of these shapes can come from a
 * keyboard or a paste, so dropping them keeps only what the user typed.
 */
// CPR · DA1/2/3 · DSR · DECRPM · window reports · OSC replies · DCS replies · focus in/out
const TERMINAL_REPORTS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC/BEL-framed terminal replies
  /\x1b\[\d+;\d+R|\x1b\[[?>=][\d;]*c|\x1b\[\d*n|\x1b\[\??[\d;]*\$y|\x1b\[\d+;\d+;\d+t|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\|\x1b\[[IO]/g;

export function stripTerminalReports(data: string): string {
  return data.replace(TERMINAL_REPORTS, "");
}
