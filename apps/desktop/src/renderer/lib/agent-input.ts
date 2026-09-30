/** Single submit path for sending text to a live agent's PTY.
 *  Bracketed paste guards multi-line text from per-line submission
 *  (claude-code submits on bare \r — see terminal-setup.ts Shift+Enter). */
/** Paste into an agent's input without submitting: the user adds context and presses Enter.
 *  Bracketed so a multi-line text is one paste, never line-by-line input */
export function pasteToAgent(agentId: string, text: string): void {
  window.api.terminal.write(agentId, text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);
}

export function submitToAgent(agentId: string, text: string): void {
  const body = text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text;
  window.api.terminal.write(agentId, `${body}\r`);
}
