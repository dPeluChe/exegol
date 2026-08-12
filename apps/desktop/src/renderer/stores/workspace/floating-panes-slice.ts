import type { WorkspaceSliceCreator, WorkspaceStore } from "./types";

export type FloatingPanesSlice = Pick<
  WorkspaceStore,
  "floatingPanes" | "markPaneFloating" | "unmarkPaneFloating"
>;

export const createFloatingPanesSlice: WorkspaceSliceCreator<FloatingPanesSlice> = (set) => ({
  floatingPanes: {},

  markPaneFloating: (paneId, type) =>
    set((s) => ({
      floatingPanes: { ...s.floatingPanes, [paneId]: { type, openedAt: Date.now() } },
    })),

  unmarkPaneFloating: (paneId) =>
    set((s) => {
      if (!s.floatingPanes[paneId]) return s;
      const next = { ...s.floatingPanes };
      delete next[paneId];
      return { floatingPanes: next };
    }),
});
