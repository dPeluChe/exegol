import {
  collectPaneIds,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../stores/workspace";

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
      (document.activeElement as HTMLElement | null)?.blur();
      window.dispatchEvent(new CustomEvent("exegol:focus-pane", { detail: { paneId: target } }));
    }),
  );
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
