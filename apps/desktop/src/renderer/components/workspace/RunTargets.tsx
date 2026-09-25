import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderGit2, FolderTree, GitBranch, Play, Star, Terminal, Zap } from "lucide-react";
import { useState } from "react";
import type { DetectedScript } from "../../hooks/use-trpc-scheduler";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

interface RunTarget {
  rel: string;
  path: string;
  git: boolean;
  scripts: DetectedScript[];
}

const VISIBLE_COMMANDS = 4;
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
 * row below it opens that folder's Terminal, Files and Git, then its commands
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
  const [chosen, setChosen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const updatePane = useWorkspaceStore((s) => s.updatePane);

  // Default: a folder holding a pin, else the root when it has commands, else the first repo
  const pinnedRel = pins[0]?.split("\u0000")[0];
  const selected =
    targets.find((t) => t.rel === chosen) ??
    targets.find((t) => t.rel === pinnedRel) ??
    targets.find((t) => t.rel !== "" || t.scripts.length > 0) ??
    targets[0];
  if (!selected) return null;
  const inFolder = selected.rel !== "";

  const pinned = selected.scripts.filter((s) => pins.includes(pinKey(selected.rel, s.command)));
  const rest = selected.scripts.filter((s) => !pins.includes(pinKey(selected.rel, s.command)));
  const shown = expanded ? rest : rest.slice(0, Math.max(0, VISIBLE_COMMANDS - pinned.length));
  const hidden = rest.length - shown.length;

  const run = async (label: string, command?: string) => {
    setLaunching(label);
    try {
      // The root keeps the normal start folder rules (worktrees included)
      const agentId = await spawnShellIntoPane(
        projectId,
        paneId,
        label,
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
    <div className={cn("flex w-full flex-col items-center gap-1.5", compact ? "mt-1.5" : "mt-3")}>
      {targets.length > 1 && (
        <div className="flex flex-wrap justify-center gap-1">
          {!compact && <span className="self-center text-[9px] text-text-muted">Run in</span>}
          {targets.map((t) => {
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
                {t.rel || "root"}
                {t.scripts.some((s) => s.source === "convex") && (
                  <Zap className="h-2.5 w-2.5 text-amber-400" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex max-w-full flex-wrap justify-center gap-1">
        {/* The folder's own views: a terminal in it, its files, its git (when it is a repo) */}
        <button
          type="button"
          disabled={!!launching}
          onClick={() => run(inFolder ? (selected.rel.split("/").pop() ?? "Terminal") : "Terminal")}
          className={cn(
            chip,
            size,
            "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
          )}
          title={`Terminal in ${selected.path}`}
        >
          <Terminal className="h-3 w-3" />
          Terminal
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
