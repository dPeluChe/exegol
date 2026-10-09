import {
  collectPaneIds,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../stores/workspace";
import { focusedField } from "./focused-field";

/** The element of a workspace pane (WorkspacePane's data-pane-id) */
export function paneRoot(paneId: string): Element | null {
  return document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"]`);
}

/** The pane after `current` (or before it), wrapping around; the first one without a current */
export function adjacentPane(
  paneIds: string[],
  current: string | null,
  direction: "next" | "prev",
): string | null {
  if (paneIds.length === 0) return null;
  const at = current ? paneIds.indexOf(current) : -1;
  if (at === -1) return paneIds[0] ?? null;
  const step = direction === "next" ? 1 : -1;
  return paneIds[(at + step + paneIds.length) % paneIds.length] ?? null;
}

/**
 * Keyboard navigation lands the cursor where it went: the active tab's focused pane (or its
 * first) gets the keyboard, as a click would give it. Only navigation calls this: a click keeps
 * the focus it chose (a rename field in the toolbar must not lose it to the terminal).
 */
export function focusActivePane(paneId?: string): void {
  // Two frames: the switched tab or project renders first
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const { tabs, activeTabId } = getProjectState();
      const tab = tabs.find((t) => t.id === activeTabId);
      const target = paneId ?? (tab ? getFocusedOrFirstPaneId(tab) : null);
      if (!target) return;
      useWorkspaceStore.getState().setFocusedPane(target);
      // The previous terminal would keep typing otherwise when the target is not a terminal
      const active = document.activeElement as HTMLElement | null;
      if (active && !paneRoot(target)?.contains(active)) active.blur();
      window.dispatchEvent(new CustomEvent("exegol:focus-pane", { detail: { paneId: target } }));
    }),
  );
}

const focusOnMount = new Set<string>();

/**
 * A pane just opened for the user (split, launcher, new terminal): it gets the keyboard now, and
 * its view takes it again once it mounts (a shell or agent attaches after this call returns)
 */
export function focusNewPane(paneId: string): void {
  focusOnMount.add(paneId);
  focusActivePane(paneId);
}

/** A pane's view asks once it can take the keyboard: true once per focusNewPane, unless the user
 *  started typing in another field (a commit message, the palette) while the pane was opening */
export function claimPaneFocus(paneId: string): boolean {
  if (!focusOnMount.delete(paneId)) return false;
  const field = typeof document === "undefined" ? null : focusedField();
  return !field || !!paneRoot(paneId)?.contains(field);
}

/** The pane will not mount a view (its spawn failed) */
export function dropPaneFocus(paneId: string): void {
  focusOnMount.delete(paneId);
}

/** Cmd+] / Cmd+[: the next or previous pane of the active tab */
export function cyclePane(direction: "next" | "prev"): void {
  const { tabs, activeTabId } = getProjectState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  const target = adjacentPane(
    collectPaneIds(tab.layout),
    useWorkspaceStore.getState().focusedPaneId,
    direction,
  );
  if (target) focusActivePane(target);
}
