import type { Project } from "@exegol/shared";
import { useEffect } from "react";
import { matchProjectByPath } from "../lib/deeplink-match";
import { trpcInvoke } from "../lib/trpc-client";
import { useAppStore } from "../stores/app";
import { useToastStore } from "../stores/toasts";

async function openProjectByPath(path: string): Promise<void> {
  try {
    const projects = await trpcInvoke<Project[]>("projects.list");
    const project = matchProjectByPath(projects, path);
    if (project) {
      useAppStore.getState().setActiveProject(project.id);
      return;
    }
    useToastStore.getState().addToast({
      type: "warning",
      title: "Project not found",
      body: `Add ${path} as a project in Exegol first`,
    });
  } catch (err) {
    console.error("[DeepLink] Failed to open project:", err);
  }
}

/**
 * T155.6 — subscribe to `deeplink:open-path` (fired by the `exegol` CLI via
 * the exegol:// scheme) and activate the matching project. Call once in App.
 */
export function useDeepLink(): void {
  useEffect(() => {
    const unsub = window.api.onDeepLinkOpenPath?.((data) => {
      void openProjectByPath(data.path);
    });
    return () => unsub?.();
  }, []);
}
