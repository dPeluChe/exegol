import { useAppStore } from "../app";
import { collectPaneIds } from "./helpers";
import type { Pane, WorkspaceStore } from "./types";

// ─── Persist recovery (migrate + rehydrate cleanup) ─────────────────────────

export function migrateWorkspaceState(persisted: unknown, version: number) {
  if (version === 0) {
    // v0 → v1: migrate flat {tabs, panes, activeTabId} to projectWorkspaces
    const old = persisted as Record<string, unknown>;
    if (old.tabs && !old.projectWorkspaces) {
      // Can't determine which project these belong to, so discard old state
      return { projectWorkspaces: {} };
    }
  }
  return persisted as Record<string, unknown>;
}

export function onWorkspaceRehydrate(state: WorkspaceStore | undefined): void {
  if (!state) return;
  // Sync _activeProjectId from app store after rehydration
  state._activeProjectId = useAppStore.getState().activeProjectId;

  for (const pw of Object.values(state.projectWorkspaces)) {
    const cleaned: Record<string, Pane> = {};
    for (const [id, pane] of Object.entries(pw.panes)) {
      const { invalidReason: _, ...rest } = pane;
      cleaned[id] = rest;
    }
    pw.panes = cleaned;

    pw.tabs = pw.tabs.map((tab) => {
      const paneIds = collectPaneIds(tab.layout);
      const allEmpty = paneIds.every((pid) => cleaned[pid]?.type === "empty");
      if (allEmpty && paneIds.length > 1) {
        const keepId = paneIds[0] as string;
        for (const pid of paneIds) {
          if (pid !== keepId) delete cleaned[pid];
        }
        return { ...tab, layout: { type: "pane" as const, paneId: keepId } };
      }
      return tab;
    });
    pw.panes = cleaned;
  }
}
