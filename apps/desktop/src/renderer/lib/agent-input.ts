/** Single submit path for sending text to a live agent's PTY.
 *  Bracketed paste guards multi-line text from per-line submission
 *  (claude-code submits on bare \r — see terminal-setup.ts Shift+Enter). */
export function submitToAgent(agentId: string, text: string): void {
  const body = text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text;
  window.api.terminal.write(agentId, `${body}\r`);
}
