/** Types text plus a newline into an agent's PTY (browser QA and design reports) */
export const sendToAgent = (agentId: string, text: string) => {
  window.api.terminal.write(agentId, `${text}\n`);
};
