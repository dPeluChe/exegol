/**
 * T178 — don't ship bytes to a renderer that has nobody to show them to.
 *
 * The renderer already buffers writes for hidden panes (T115 dormant ring), so
 * xterm never parses them. What still happened is the expensive half: every
 * chunk from every hidden agent was structured-cloned across IPC and dispatched
 * in the renderer before being dropped on the floor. With ten agent panes open
 * and one visible, nine paid full IPC cost forever.
 *
 * The gate drops the renderer-bound broadcast only. Main still feeds its own
 * emulator, the Rust output processor, scrollback and the messaging quiescence
 * clock — everything that decides behaviour keeps seeing every byte. Hiding a
 * pane changes what is DRAWN, never what is understood.
 *
 * Two rules keep it from ever blanking a terminal:
 *  - unknown means VISIBLE. A view that never reported (a bug, a race, an older
 *    renderer) keeps receiving bytes; the gate can only ever be an optimisation.
 *  - visibility is a COUNT, not a flag. A pane and a floating window can show
 *    the same agent, so one of them hiding must not silence the other.
 */

/** agentId → number of views currently showing it. Absent = never reported. */
const viewers = new Map<string, number>();

/** Agents whose output was dropped since their last repaint. */
const missedOutput = new Set<string>();

export function setTerminalViewerVisible(agentId: string, visible: boolean): void {
  const current = viewers.get(agentId) ?? 0;
  const next = visible ? current + 1 : Math.max(0, current - 1);
  if (next === 0 && !visible) viewers.set(agentId, 0);
  else viewers.set(agentId, next);
}

/** Every view of this agent went away (pane closed, window destroyed). */
export function forgetTerminalViewers(agentId: string): void {
  viewers.delete(agentId);
  missedOutput.delete(agentId);
}

/** False only when a view has explicitly reported that none of them are shown. */
export function hasVisibleViewer(agentId: string): boolean {
  const count = viewers.get(agentId);
  return count === undefined || count > 0;
}

export function noteOutputDropped(agentId: string): void {
  missedOutput.add(agentId);
}

/** True once, when the agent has output the renderer never received — the
 *  caller must repaint from a snapshot rather than resume mid-stream. */
export function consumeMissedOutput(agentId: string): boolean {
  return missedOutput.delete(agentId);
}
