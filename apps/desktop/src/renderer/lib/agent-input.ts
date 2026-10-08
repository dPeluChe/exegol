import { type AgentStatus, RUNNING_STATUSES } from "@exegol/shared";

/** A live agent that can take pasted text. Never a shell: it would run the text line by line */
export function isPasteTarget(a: { cliType: string; status: AgentStatus }): boolean {
  return a.cliType !== "shell" && RUNNING_STATUSES.has(a.status);
}

/** Bracketed so a multi-line text is one paste, never line-by-line input. `always`: text from
 *  outside the keyboard (dictation) is a paste even on one line, so no key in it acts as one */
const pasted = (text: string, always: boolean) =>
  always || text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text;

/** Paste into an agent's input without submitting: the user adds context and presses Enter */
export function pasteToAgent(agentId: string, text: string, always = false): void {
  window.api.terminal.write(agentId, pasted(text, always));
}

/** Single submit path for sending text to a live agent's PTY (claude-code submits on a bare \r,
 *  see terminal-setup.ts Shift+Enter) */
export function submitToAgent(agentId: string, text: string, always = false): void {
  window.api.terminal.write(agentId, `${pasted(text, always)}\r`);
}
