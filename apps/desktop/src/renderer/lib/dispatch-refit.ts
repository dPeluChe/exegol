/** Refresh Terminal: each view of the session refits and redraws, and the CLI repaints */
/** Ctrl+C, as the key would send it: for a terminal that takes no keys from its view */
export const interruptTerminal = (agentId: string) => window.api.terminal.write(agentId, "\x03");

export function kickTerminal(agentId: string): void {
  window.dispatchEvent(new CustomEvent("exegol:kick-terminal", { detail: { agentId } }));
}

/** Notify all terminal instances to recalculate dimensions after a layout change. */
export function dispatchRefitTerminals(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("exegol:refit-terminals"));
  });
}
