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

/** agentId → views currently showing it, as `windowId:viewId`. Absent = never reported.
 *  Per view, not per window: a pane and its Overview mirror share a window, and
 *  the pane unmounting must not silence the mirror (T194). */
const viewers = new Map<string, Set<string>>();

/** Agents whose output was dropped since their last repaint. */
const missedOutput = new Set<string>();

export function setTerminalViewerVisible(
  agentId: string,
  windowId: number,
  visible: boolean,
  viewId = "",
): void {
  const key = `${windowId}:${viewId}`;
  const showing = viewers.get(agentId) ?? new Set<string>();
  if (visible) showing.add(key);
  else showing.delete(key);
  viewers.set(agentId, showing);
}

/** A window went away — it can no longer be showing anything. */
export function forgetViewer(windowId: number): void {
  const prefix = `${windowId}:`;
  for (const showing of viewers.values()) {
    for (const key of showing) if (key.startsWith(prefix)) showing.delete(key);
  }
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
