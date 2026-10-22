import type { FolderInspection } from "@exegol/shared";
import { Button, Input } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderSearch, X } from "lucide-react";
import { useRef, useState } from "react";
import { useCreateProject } from "../../hooks/use-trpc";
import { folderName, isAbsoluteFolder } from "../../lib/add-project";
import { trpcInvoke } from "../../lib/trpc-client";
import { showProject } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import {
  type FoundIcon,
  type ProjectAppearance,
  ProjectIconPicker,
} from "../layout/ProjectIconPicker";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Typing waits this long before the folder is inspected and scanned for icons */
const CHECK_DELAY_MS = 300;

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const [folderPath, setFolderPath] = useState("");
  const [checkedPath, setCheckedPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  // Nothing picked: the first image found, which is what create adopts on its own
  const [picked, setPicked] = useState<ProjectAppearance | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scanPath = folderPath.trim();
  const canCheck = open && isAbsoluteFolder(checkedPath);
  const { data: found = [], isFetching: scanning } = useQuery({
    queryKey: ["projects", "detectIconsAt", checkedPath],
    queryFn: () => trpcInvoke<FoundIcon[]>("projects.detectIconsAt", { path: checkedPath }),
    enabled: canCheck,
    staleTime: 30_000,
  });
  const { data: inspection } = useQuery({
    queryKey: ["projects", "inspectFolder", checkedPath],
    queryFn: () =>
      trpcInvoke<FolderInspection | null>("projects.inspectFolder", { path: checkedPath }),
    enabled: canCheck,
  });
  // Only once the check caught up with what is typed: a stale verdict would name another folder
  const notice =
    checkedPath === scanPath && inspection && inspection.kind !== "repo" ? inspection : null;
  const appearance = picked ?? {
    color: null,
    icon: null,
    iconImage: found[0]?.path ?? null,
  };

  const queryClient = useQueryClient();
  const createProject = useCreateProject();
  const setActiveProject = useAppStore((s) => s.setActiveProject);

  const changeFolder = (value: string, delay: number) => {
    setFolderPath(value);
    // A choice from another folder would point outside this one
    setPicked(null);
    createProject.reset();
    if (!projectName || projectName === folderName(folderPath)) {
      setProjectName(folderName(value));
    }
    clearTimeout(checkTimer.current);
    if (delay) checkTimer.current = setTimeout(() => setCheckedPath(value.trim()), delay);
    else setCheckedPath(value.trim());
  };

  const handleBrowse = async () => {
    try {
      // Use Electron dialog via IPC (exposed through preload)
      const result = await window.api.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Project Folder",
      });
      if (result && !result.canceled && result.filePaths?.[0]) {
        changeFolder(result.filePaths[0], 0);
      }
    } catch {
      // Dialog not available in dev, user can type manually
    }
  };

  const resetAndClose = () => {
    clearTimeout(checkTimer.current);
    setFolderPath("");
    setCheckedPath("");
    setProjectName("");
    setDefaultBranch("main");
    setPicked(null);
    onOpenChange(false);
  };

  const goToProject = (id: string) => {
    resetAndClose();
    showProject(id);
  };

  // isPending lands a render late: a double Enter would create the project twice
  const submittingRef = useRef(false);
  const addProject = async (initGit = false) => {
    if (!scanPath || !projectName.trim() || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const project = await createProject.mutateAsync({
        name: projectName.trim(),
        path: scanPath,
        gitRemote: null,
        defaultBranch: defaultBranch.trim() || "main",
        appearance: picked ?? undefined,
        initGit,
      });
      setActiveProject(project.id);
      resetAndClose();
    } catch (err) {
      // Added meanwhile (another window, a race with the check): the notice offers Go to project
      if ((err as { code?: string }).code === "CONFLICT") {
        queryClient.invalidateQueries({ queryKey: ["projects", "inspectFolder"] });
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const blocked = notice !== null && notice.kind !== "subfolder";
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blocked) void addProject();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="min-w-0 text-base font-semibold text-text-primary">
              Add Project
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Folder Path */}
            <div className="space-y-1.5">
              <label
                htmlFor="add-project-folder"
                className="text-xs font-medium text-text-secondary"
              >
                Project Folder
              </label>
              <div className="flex gap-2">
                <Input
                  id="add-project-folder"
                  value={folderPath}
                  onChange={(e) => changeFolder(e.target.value, CHECK_DELAY_MS)}
                  placeholder="/path/to/your/project"
                  className="flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                  className="shrink-0 border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/5"
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
              {notice ? (
                <FolderNoticeView
                  notice={notice}
                  busy={createProject.isPending}
                  onGoTo={goToProject}
                  onUseToplevel={(toplevel) => changeFolder(toplevel, 0)}
                  onAdd={(initGit) => void addProject(initGit)}
                />
              ) : (
                <p className="text-[10px] text-text-muted">Must be a git repository</p>
              )}
            </div>

            {/* Project Name */}
            <div className="space-y-1.5">
              <label htmlFor="add-project-name" className="text-xs font-medium text-text-secondary">
                Project Name
              </label>
              <Input
                id="add-project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-project"
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>

            {/* Default Branch */}
            <div className="space-y-1.5">
              <label
                htmlFor="add-project-branch"
                className="text-xs font-medium text-text-secondary"
              >
                Default Branch
              </label>
              <Input
                id="add-project-branch"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>

            {/* Icon: scanned as soon as the folder is known */}
            {scanPath && (
              <div>
                <ProjectIconPicker
                  found={found}
                  isLoading={scanning}
                  value={appearance}
                  onChange={setPicked}
                />
              </div>
            )}

            {/* Error: an already added folder is the notice's job */}
            {createProject.isError && notice?.kind !== "existing" && (
              <p className="text-xs text-error">
                Failed to add project: {createProject.error?.message}
              </p>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-[var(--text-secondary)]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!scanPath || !projectName.trim() || createProject.isPending || blocked}
                className="bg-accent text-white"
              >
                {createProject.isPending ? "Adding..." : "Add Project"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolderNoticeView({
  notice,
  busy,
  onGoTo,
  onUseToplevel,
  onAdd,
}: {
  notice: Exclude<FolderInspection, { kind: "repo" }>;
  busy: boolean;
  onGoTo: (id: string) => void;
  onUseToplevel: (toplevel: string) => void;
  onAdd: (initGit: boolean) => void;
}) {
  if (notice.kind === "missing") return <p className="text-xs text-error">Folder not found</p>;
  if (notice.kind === "notDirectory") {
    return <p className="text-xs text-error">This path is a file, not a folder</p>;
  }
  if (notice.kind === "existing") {
    return (
      <NoticeBox message={`Already in Exegol as '${notice.name}'`}>
        <Button type="button" size="sm" onClick={() => onGoTo(notice.id)}>
          Go to project
        </Button>
      </NoticeBox>
    );
  }
  if (notice.kind === "noGit") {
    return (
      <NoticeBox message="This folder is not a git repository">
        <Button type="button" size="sm" disabled={busy} onClick={() => onAdd(true)}>
          Initialize git and add
        </Button>
      </NoticeBox>
    );
  }
  return (
    <NoticeBox message={`This folder is inside the repo ${notice.toplevel}`}>
      <Button type="button" size="sm" onClick={() => onUseToplevel(notice.toplevel)}>
        Use {folderName(notice.toplevel)}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAdd(false)}
      >
        Add this folder anyway
      </Button>
    </NoticeBox>
  );
}

function NoticeBox({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2">
      <p className="break-all text-xs text-warning">{message}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
