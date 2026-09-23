/**
 * Main tracks terminal visibility per WINDOW, but one window can hold several
 * views of the same session (its pane and an Overview mirror). Without this
 * count, the pane unmounting told main "nobody sees it" while the mirror was
 * still on screen: output stopped, then came back as a full snapshot repaint.
 * Only the first view to appear and the last to go are reported.
 */
const counts = new Map<string, number>();

export function showTerminalView(agentId: string): void {
  const n = counts.get(agentId) ?? 0;
  counts.set(agentId, n + 1);
  if (n === 0) window.api.terminal.setVisible(agentId, true).catch(() => {});
}

export function hideTerminalView(agentId: string): void {
  const n = counts.get(agentId) ?? 0;
  if (n <= 1) {
    counts.delete(agentId);
    window.api.terminal.setVisible(agentId, false).catch(() => {});
  } else {
    counts.set(agentId, n - 1);
  }
}
