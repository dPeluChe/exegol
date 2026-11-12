import {
  DEFAULT_WORKTREE_COPY,
  type Project,
  parseBrowserHosts,
  parseWorktreeCopy,
  worktreeCopyPatterns,
} from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";
import { SegmentedTabs } from "../common/SegmentedTabs";
import { ProjectBrowserTab } from "./ProjectBrowserTab";
import { ProjectGeneralTab } from "./ProjectGeneralTab";
import { ProjectMcpTab } from "./ProjectMcpTab";

type ProjectTab = "general" | "browser" | "worktrees" | "mcp";

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "browser", label: "Browser" },
  { id: "worktrees", label: "Worktrees" },
  { id: "mcp", label: "MCP" },
];

const PANEL_ID = "project-settings-panel";

/** A project's settings, from its sidebar menu. Save commits the drafts (name, browser hosts and
 *  eval, worktree patterns); what a tab applies on pick says so there */
export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onRename,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const refreshProjects = () =>
    queryClient.invalidateQueries({ queryKey: ["projects"], exact: true });
  const [tab, setTab] = useState<ProjectTab>("general");
  const [name, setName] = useState(project.name);
  const savedHosts = (project.browserHosts ?? []).join("\n");
  const [hosts, setHosts] = useState(savedHosts);
  const [allowEval, setAllowEval] = useState(!!project.browserEval);
  const saveBrowser = useMutation({
    mutationFn: (input: { hosts: string[]; allowEval: boolean }) =>
      trpcMutate("projects.setBrowserHosts", { id: project.id, ...input }),
    onSuccess: refreshProjects,
    onError: toastError("Could not save the agent browser settings"),
  });
  const savedCopy = worktreeCopyPatterns(project.worktreeCopy).join("\n");
  const [copy, setCopy] = useState(savedCopy);
  const saveCopy = useMutation({
    mutationFn: (patterns: string[]) =>
      trpcMutate("projects.setWorktreeCopy", { id: project.id, patterns }),
    onSuccess: refreshProjects,
    onError: toastError("Could not save the worktree file patterns"),
  });
  const saveAndClose = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    const list = parseBrowserHosts(hosts);
    if (list.join("\n") !== savedHosts || allowEval !== !!project.browserEval) {
      saveBrowser.mutate({ hosts: list, allowEval });
    }
    if (parseWorktreeCopy(copy).join("\n") !== savedCopy) saveCopy.mutate(copy.split("\n"));
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-[10vh] z-50 max-h-[80vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-y-auto rounded-lg border p-4 shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <Dialog.Title className="min-w-0 text-sm font-semibold text-text-primary">
              Edit project
            </Dialog.Title>
            <Dialog.Close className="shrink-0 rounded p-1 text-text-muted hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          <div className="mb-3">
            <SegmentedTabs
              tabs={PROJECT_TABS}
              active={tab}
              onChange={setTab}
              compact
              label="Project settings"
              panelId={PANEL_ID}
            />
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-${tab}`}>
            {tab === "general" && (
              <ProjectGeneralTab
                project={project}
                name={name}
                onName={setName}
                onEnter={saveAndClose}
              />
            )}

            {tab === "browser" && (
              <ProjectBrowserTab
                projectId={project.id}
                hosts={hosts}
                onHosts={setHosts}
                allowEval={allowEval}
                onAllowEval={setAllowEval}
              />
            )}

            {tab === "worktrees" && (
              <label className="mb-3 block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
                  Copy into new worktrees
                </span>
                <textarea
                  value={copy}
                  onChange={(e) => setCopy(e.target.value)}
                  rows={3}
                  placeholder={DEFAULT_WORKTREE_COPY.join("\n")}
                  className="w-full min-w-0 resize-y rounded border border-border bg-bg-tertiary px-2 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-accent/50"
                />
                <span className="mt-1 block text-[10px] text-text-muted">
                  Gitignored files of the checkout copied into each new agent or pipeline worktree
                  before it starts, never over a file already there. Gitignore syntax, one per line;
                  !pattern leaves a file out. Empty copies nothing.
                </span>
              </label>
            )}

            {tab === "mcp" && <ProjectMcpTab project={project} onSaved={refreshProjects} />}
          </div>

          <div className="mt-4 flex">
            <button
              type="button"
              onClick={saveAndClose}
              className="ml-auto rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
