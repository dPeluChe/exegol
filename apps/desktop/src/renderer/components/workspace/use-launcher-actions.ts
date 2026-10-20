import type { LauncherFolder, ProjectDetect } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { LauncherAction } from "../../lib/launcher";
import { openProjectInIde } from "../../lib/open-in-ide";
import { dropPaneFocus, focusNewPane } from "../../lib/pane-focus";
import { projectBrowserUrl } from "../../lib/project-browser-url";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { toastError, useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

const detectKey = (projectId: string) => ["resources", "projectDetect", projectId];

/** T204: the launcher's one detection (folders and kinds, editor, file manager) and its refresh */
export function useProjectDetect(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: detectKey(projectId),
    queryFn: () => trpcInvoke<ProjectDetect>("resources.projectDetect", { projectId }),
    // A new launcher lists the folders again (a readdir; scripts and kinds stay cached in main)
    staleTime: 5_000,
  });
  const refresh = useMutation({
    mutationFn: () => trpcMutate<ProjectDetect>("resources.refreshProjectDetect", { projectId }),
    onSuccess: (next) => queryClient.setQueryData(detectKey(projectId), next),
    onError: toastError("Could not refresh the folders"),
  });
  return { detect: query.data, refresh };
}

/** Pinned run commands of the project ("rel\0command"), and the pin toggle */
export function useRunPins(projectId: string) {
  const queryClient = useQueryClient();
  const { data: pins = [] } = useQuery({
    queryKey: ["resources", "runPins", projectId],
    queryFn: () => trpcInvoke<string[]>("resources.runPins", { projectId }),
    // Only this client changes them, and the mutation writes the result back
    staleTime: Number.POSITIVE_INFINITY,
  });
  const togglePin = useMutation({
    mutationFn: (key: string) => trpcMutate<string[]>("resources.toggleRunPin", { projectId, key }),
    onSuccess: (next) => queryClient.setQueryData(["resources", "runPins", projectId], next),
  });
  return { pins, togglePin: (key: string) => togglePin.mutate(key) };
}

/** A shell named after where it runs: what it runs is its live step, gone once it exits */
export function terminalNameFor(folder: LauncherFolder): string {
  return folder.rel ? (folder.rel.split("/").pop() ?? "Terminal") : "Terminal";
}

/** What the launcher's pane buttons and keys do in its folder */
export function useLauncherActions({
  projectId,
  projectPath,
  paneId,
  folder,
}: {
  projectId: string;
  projectPath: string | undefined;
  paneId: string;
  folder: LauncherFolder | undefined;
}) {
  const [launching, setLaunching] = useState<string | null>(null);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const inFolder = !!folder && folder.rel !== "";
  // The root keeps the normal start folder rules (worktrees included)
  const cwd = inFolder ? folder?.path : undefined;

  const runCommand = async (label: string, command?: string) => {
    if (!folder || launching) return;
    setLaunching(label);
    focusNewPane(paneId);
    try {
      const agentId = await spawnShellIntoPane(projectId, paneId, terminalNameFor(folder), cwd);
      if (command) window.api.terminal.write(agentId, `${command}\n`);
    } catch (err) {
      dropPaneFocus(paneId);
      useToastStore.getState().addToast({
        type: "error",
        title: `Could not start ${label}`,
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLaunching(null);
    }
  };

  const run = (action: LauncherAction, fileManager: string) => {
    if (!folder) return;
    if (action === "terminal") void runCommand(terminalNameFor(folder));
    if (action === "files")
      updatePane(paneId, { type: "files", filePath: cwd, openFile: undefined });
    if (action === "git") updatePane(paneId, { type: "git", filePath: cwd });
    if (action === "browser") {
      void projectBrowserUrl(projectId, projectPath).then((url) =>
        updatePane(paneId, { type: "browser", url }),
      );
    }
    if (action === "finder") {
      trpcMutate("projects.openFolder", { projectId, path: folder.path }).catch(
        toastError(`Could not open ${fileManager}`),
      );
    }
    if (action === "editor") openProjectInIde({ projectId, file: cwd });
    if (action === "simulator") {
      focusNewPane(paneId);
      updatePane(paneId, { type: "simulator" });
    }
  };

  return { run, runCommand, launching };
}
