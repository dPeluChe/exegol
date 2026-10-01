import { useWorkspaceStore } from "../stores/workspace";
import { useMountEffect } from "./use-mount-effect";

/**
 * T84: keep the workspace store's `floatingPanes` in sync with the main
 * process. When the user closes a floating window (traffic light), main
 * sends a "floating:closed" IPC event; we unmark the pane so the main
 * window re-renders the inline content instead of the "Floating" placeholder.
 */
export function useFloatingPaneSync() {
  useMountEffect(() => {
    const unsub = window.api.floating.onClosed((paneId, page) => {
      const ws = useWorkspaceStore.getState();
      // A floating browser docks back on the page it was on
      if (page) ws.setPaneUrl(paneId, page);
      ws.unmarkPaneFloating(paneId);
    });
    return unsub;
  });
}
