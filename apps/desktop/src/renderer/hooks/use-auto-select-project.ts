import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/app";
import { useProjects } from "./use-trpc";

/**
 * Ensures the workspace view is the default on startup.
 *
 * Rules:
 * - Cold start, valid persisted activeProjectId → no-op (workspace restores)
 * - Cold start, stale persisted activeProjectId → auto-select first available
 * - Cold start, no activeProjectId but ≥1 project → auto-select first
 * - No projects at all → leave null so user sees the "add project" empty state
 * - Runtime: user clicks "Add project" (sets null intentionally) → never hijack
 * - Runtime: user deletes the active project → auto-jump to another if possible
 */
export function useAutoSelectProject() {
  const { data: projects, isLoading } = useProjects();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (isLoading || !projects) return;
    const state = useAppStore.getState();
    const { activeProjectId } = state;

    // Stale reference (project deleted from DB): pick another or clear.
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      const next = projects[0];
      state.setActiveProject(next ? next.id : null);
      hasRunRef.current = true;
      return;
    }

    // First mount only: if no active project, auto-select the first one.
    // Subsequent null transitions (user clicked "Add project") are left alone.
    if (!hasRunRef.current && !activeProjectId && projects.length > 0) {
      state.setActiveProject(projects[0]?.id ?? null);
    }
    hasRunRef.current = true;
  }, [projects, isLoading]);
}
