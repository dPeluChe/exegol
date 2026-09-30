import { type AgentStatus, RUNNING_STATUSES } from "@exegol/shared";

/** A live agent that can take pasted text. Never a shell: it would run the text line by line */
export function isPasteTarget(a: { cliType: string; status: AgentStatus }): boolean {
  return a.cliType !== "shell" && RUNNING_STATUSES.has(a.status);
}

/** Paste into an agent's input without submitting: the user adds context and presses Enter.
 *  Bracketed so a multi-line text is one paste, never line-by-line input */
export function pasteToAgent(agentId: string, text: string): void {
  window.api.terminal.write(agentId, text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);
}

/** Single submit path for sending text to a live agent's PTY (claude-code submits on a bare \r,
 *  see terminal-setup.ts Shift+Enter) */
export function submitToAgent(agentId: string, text: string): void {
  const body = text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text;
  window.api.terminal.write(agentId, `${body}\r`);
}
