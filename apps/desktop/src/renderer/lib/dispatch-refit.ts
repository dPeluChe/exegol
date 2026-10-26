/** Refresh Terminal: each view of the session refits and redraws, and the CLI repaints */
export function kickTerminal(agentId: string): void {
  window.dispatchEvent(new CustomEvent("exegol:kick-terminal", { detail: { agentId } }));
}

/** Notify all terminal instances to recalculate dimensions after a layout change. */
export function dispatchRefitTerminals(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("exegol:refit-terminals"));
  });
}
