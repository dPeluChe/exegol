import { ideLabel } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Code2,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranch,
  Play,
  RefreshCw,
  Star,
  Terminal,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useProjectIde, useSettings } from "../../hooks/use-trpc";
import type { DetectedScript } from "../../hooks/use-trpc-scheduler";
import { fileManagerLabel } from "../../lib/keymap";
import { openProjectInIde } from "../../lib/open-in-ide";
import { paneRoot } from "../../lib/pane-focus";
import { pickRunTarget, runTargetLabel, visibleRunTargets } from "../../lib/run-targets";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { isQuickTerminalKey } from "../../lib/split-terminal";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAppStore } from "../../stores/app";
import { toastError, useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

interface RunTarget {
  rel: string;
  path: string;
  git: boolean;
  scripts: DetectedScript[];
}

const VISIBLE_COMMANDS = 4;

const isTypingField = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  (el instanceof HTMLElement && el.isContentEditable);
const pinKey = (rel: string, command: string) => `${rel}\u0000${command}`;

function runnerLabel(s: DetectedScript): string | null {
  const src = s.source.toLowerCase();
  if (src.includes("makefile")) return "make";
  if (src.includes("justfile")) return "just";
  if (s.source.startsWith(".exegol/")) return "custom";
  return s.framework ?? null;
}

/**
 * T197: where to run and what. A workspace of repos has nothing to run at its
 * root, so the launcher showed no commands; each folder is a chip, and the
 * row below it opens that folder's Terminal, Files, Git, file manager and IDE, then its commands
 * (pinned first, the rest behind "+N"). Always shown, so those three stay.
 */
export function RunTargets({
  projectId,
  paneId,
  compact,
}: {
  projectId: string;
  paneId: string;
  compact: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: targets = [] } = useQuery({
    queryKey: ["resources", "runTargets", projectId],
    queryFn: () => trpcInvoke<RunTarget[]>("resources.runTargets", { projectId }),
    staleTime: 60_000,
  });
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
  const refresh = useMutation({
    mutationFn: () => trpcMutate<RunTarget[]>("resources.refreshRunTargets", { projectId }),
    onSuccess: (next) => queryClient.setQueryData(["resources", "runTargets", projectId], next),
    onError: toastError("Could not refresh the folders"),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [folderQuery, setFolderQuery] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const { data: settings } = useSettings();
  const { data: projectIde } = useProjectIde(projectId);
  const ideName = ideLabel(projectIde ?? settings?.defaultIde ?? "vscode");
  const fileManager = fileManagerLabel();

  // Default: a folder holding a pin, else the root when it has commands, else the first repo
  const pinnedRel = pins[0]?.split("\u0000")[0];
  const selected = pickRunTarget(targets, chosen, pinnedRel);
  const quickTerminal = useLatest(() => {
    if (selected && !launching) void run(terminalName);
  });
  useMountEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useWorkspaceStore.getState().focusedPaneId !== paneId) return;
      if (useAppStore.getState().activeView !== "workspace") return;
      const active = document.activeElement;
      const inPane = !active || active === document.body || !!paneRoot(paneId)?.contains(active);
      if (!inPane || !isQuickTerminalKey(e, isTypingField(active))) return;
      e.preventDefault();
      quickTerminal.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!selected) return null;
  const folders = visibleRunTargets(targets, {
    query: folderQuery,
    expanded: showAllFolders,
    selectedRel: selected.rel,
  });
  const inFolder = selected.rel !== "";
  const terminalName = inFolder ? (selected.rel.split("/").pop() ?? "Terminal") : "Terminal";

  const isPinnedScript = (s: { command: string }) => pins.includes(pinKey(selected.rel, s.command));
  const pinned = selected.scripts.filter(isPinnedScript);
  const rest = selected.scripts.filter((s) => !isPinnedScript(s));
  const shown = expanded ? rest : rest.slice(0, Math.max(0, VISIBLE_COMMANDS - pinned.length));
  const hidden = rest.length - shown.length;

  const run = async (label: string, command?: string) => {
    setLaunching(label);
    try {
      // The root keeps the normal start folder rules (worktrees included)
      // Named by where it runs: what it runs is its live step, gone once the command exits
      const agentId = await spawnShellIntoPane(
        projectId,
        paneId,
        terminalName,
        inFolder ? selected.path : undefined,
      );
      if (command) window.api.terminal.write(agentId, `${command}\n`);
    } catch (err) {
      useToastStore.getState().addToast({
        type: "error",
        title: `Could not start ${label}`,
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLaunching(null);
    }
  };

  const chip = "flex items-center gap-1 rounded-lg border transition-all";
  const size = compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1 text-[11px]";

  return (
    <div
      className={cn(
        "flex w-full max-w-sm flex-col items-center gap-1.5",
        compact ? "mt-1.5" : "mt-3",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
          Run in
        </span>
        <button
          type="button"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
          className="text-text-muted hover:text-text-secondary disabled:opacity-60"
          title="Find the folders and their commands again"
          aria-label="Refresh folders"
        >
          <RefreshCw className={cn("h-2.5 w-2.5", refresh.isPending && "animate-spin")} />
        </button>
        {folders.filterable && (
          <input
            type="text"
            value={folderQuery}
            onChange={(e) => setFolderQuery(e.target.value)}
            placeholder="Filter folders"
            aria-label="Filter folders"
            className="w-28 rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
          />
        )}
      </div>
      {targets.length > 1 && (
        <div className="flex flex-wrap justify-center gap-1">
          {folders.shown.map((t) => {
            const active = t.rel === selected.rel;
            const Icon = t.git ? FolderGit2 : Folder;
            return (
              <button
                key={t.rel || "(root)"}
                type="button"
                onClick={() => {
                  setChosen(t.rel);
                  setExpanded(false);
                }}
                className={cn(
                  chip,
                  size,
                  active
                    ? "border-accent/60 bg-accent/10 text-text-primary"
                    : "border-border bg-bg-secondary text-text-muted hover:text-text-secondary",
                )}
                title={t.path}
              >
                <Icon className="h-3 w-3" />
                {runTargetLabel(t)}
                {t.scripts.some((s) => s.source === "convex") && (
                  <Zap className="h-2.5 w-2.5 text-amber-400" />
                )}
              </button>
            );
          })}
          {folders.hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAllFolders(true)}
              className={cn(
                chip,
                size,
                "border-dashed border-border text-text-muted hover:text-text-secondary",
              )}
            >
              +{folders.hidden} more
            </button>
          )}
          {showAllFolders && folders.filterable && !folderQuery && (
            <button
              type="button"
              onClick={() => setShowAllFolders(false)}
              className={cn(
                chip,
                size,
                "border-transparent text-text-muted hover:text-text-secondary",
              )}
            >
              Show fewer
            </button>
          )}
        </div>
      )}

      <div className="flex max-w-full flex-wrap justify-center gap-1">
        {/* The folder's own views: a terminal in it, its files, its git (when it is a repo) */}
        <button
          type="button"
          disabled={!!launching}
          onClick={() => run(terminalName)}
          className={cn(
            chip,
            size,
            "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
          )}
          title={`Terminal in ${selected.path} (T)`}
        >
          <Terminal className="h-3 w-3" />
          Terminal
          <kbd className="rounded border border-border px-1 font-sans text-[9px] text-text-muted">
            T
          </kbd>
        </button>
        <button
          type="button"
          onClick={() =>
            updatePane(paneId, {
              type: "files",
              filePath: inFolder ? selected.path : undefined,
              openFile: undefined,
            })
          }
          className={cn(
            chip,
            size,
            "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
          )}
          title={`Files of ${selected.path}`}
        >
          <FolderTree className="h-3 w-3" />
          Files
        </button>
        {(!inFolder || selected.git) && (
          <button
            type="button"
            onClick={() =>
              updatePane(paneId, { type: "git", filePath: inFolder ? selected.path : undefined })
            }
            className={cn(
              chip,
              size,
              "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
            )}
            title={`Git of ${selected.path}`}
          >
            <GitBranch className="h-3 w-3" />
            Git
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            trpcMutate("projects.openFolder", { projectId, path: selected.path }).catch(
              toastError(`Could not open ${fileManager}`),
            )
          }
          className={cn(
            chip,
            size,
            "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
          )}
          title={`Open ${selected.path} in ${fileManager}`}
        >
          <FolderOpen className="h-3 w-3" />
          {fileManager}
        </button>
        <button
          type="button"
          onClick={() =>
            openProjectInIde({ projectId, file: inFolder ? selected.path : undefined })
          }
          className={cn(
            chip,
            size,
            "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
          )}
          title={`Open ${selected.path} in ${ideName}`}
        >
          <Code2 className="h-3 w-3" />
          {ideName}
        </button>
        {selected.scripts.length > 0 && <span className="mx-0.5 w-px self-stretch bg-border" />}
        {[...pinned, ...shown].map((s) => {
          const key = pinKey(selected.rel, s.command);
          const isPinned = pins.includes(key);
          const label = runnerLabel(s);
          const Icon = s.source === "convex" ? Zap : Play;
          return (
            <span
              key={key}
              className={cn(
                chip,
                "group border-border bg-bg-secondary",
                launching === s.name && "opacity-50",
              )}
            >
              <button
                type="button"
                disabled={!!launching}
                onClick={() => run(s.name, s.command)}
                title={s.command}
                className={cn(
                  "flex items-center gap-1 text-text-secondary hover:text-text-primary",
                  size,
                  "pr-0",
                )}
              >
                <Icon className={cn("h-3 w-3", s.source === "convex" && "text-amber-400")} />
                {s.name}
                {label && !compact && <span className="text-[9px] text-text-muted">({label})</span>}
              </button>
              <button
                type="button"
                onClick={() => togglePin.mutate(key)}
                className={cn(
                  "px-1 text-text-muted hover:text-amber-400",
                  isPinned ? "text-amber-400" : "opacity-0 group-hover:opacity-100",
                )}
                title={isPinned ? "Unpin" : "Pin to the front"}
              >
                <Star className="h-2.5 w-2.5" fill={isPinned ? "currentColor" : "none"} />
              </button>
            </span>
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn(
              chip,
              size,
              "border-dashed border-border text-text-muted hover:text-text-secondary",
            )}
          >
            +{hidden}
          </button>
        )}
      </div>
    </div>
  );
}
