/**
 * T178 — don't ship bytes to a renderer that has nobody to show them to.
 *
 * The renderer already avoided PARSING output for hidden panes (T115 dormant
 * ring), but the expensive half still ran: every chunk from every hidden agent
 * was structured-cloned across IPC and dispatched before being dropped. With
 * ten agent panes open and one visible, nine paid full IPC cost forever.
 *
 * The gate drops the renderer-bound broadcast only. Main still feeds its own
 * emulator, the Rust output processor, scrollback and the messaging quiescence
 * clock — everything that decides behaviour keeps seeing every byte. Hiding a
 * pane changes what is DRAWN, never what is understood.
 *
 * Viewers are tracked by IDENTITY, not by a counter. A counter can only be
 * decremented by someone who remembers to, so an unmount without a matching
 * "hidden", or a renderer reload, leaves a phantom viewer and the gate silently
 * stops engaging — a failure you cannot see in a bug report. Keyed by
 * webContents id, a reload simply drops every id that window held.
 */

/** agentId → webContents ids currently showing it. Absent = never reported. */
const viewers = new Map<string, Set<number>>();

/** Agents whose output was dropped since their last repaint. */
const missedOutput = new Set<string>();

export function setTerminalViewerVisible(
  agentId: string,
  viewerId: number,
  visible: boolean,
): void {
  const showing = viewers.get(agentId) ?? new Set<number>();
  if (visible) showing.add(viewerId);
  else showing.delete(viewerId);
  viewers.set(agentId, showing);
}

/** A window went away — it can no longer be showing anything. */
export function forgetViewer(viewerId: number): void {
  for (const showing of viewers.values()) showing.delete(viewerId);
}

/** Every view of this agent is gone for good (session ended). */
export function forgetTerminalViewers(agentId: string): void {
  viewers.delete(agentId);
  missedOutput.delete(agentId);
}

/** False only when a view has explicitly reported that none of them are shown. */
export function hasVisibleViewer(agentId: string): boolean {
  const showing = viewers.get(agentId);
  return showing === undefined || showing.size > 0;
}

export function noteOutputDropped(agentId: string): void {
  missedOutput.add(agentId);
}

/** True once, when the agent has output the renderer never received — the
 *  caller must repaint from a snapshot rather than resume mid-stream. */
export function consumeMissedOutput(agentId: string): boolean {
  return missedOutput.delete(agentId);
}
