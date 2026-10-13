import type { LauncherFolder } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Code2,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe,
  type LucideIcon,
  Play,
  Smartphone,
  Star,
  Terminal,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { LAUNCHER_ACTION_KEYS, type LauncherAction } from "../../lib/launcher";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { Kbd } from "../common/Kbd";

type Script = LauncherFolder["scripts"][number];

const VISIBLE_COMMANDS = 4;

const pinKey = (rel: string, command: string) => `${rel}\u0000${command}`;

function runnerLabel(s: Script): string | null {
  const src = s.source.toLowerCase();
  if (src.includes("makefile")) return "make";
  if (src.includes("justfile")) return "just";
  if (s.source.startsWith(".exegol/")) return "custom";
  return s.framework ?? null;
}

const ACTION_META: Record<LauncherAction, { icon: LucideIcon; label: string }> = {
  terminal: { icon: Terminal, label: "Terminal" },
  files: { icon: FolderTree, label: "Files" },
  git: { icon: GitBranch, label: "Git" },
  browser: { icon: Globe, label: "Browser" },
  finder: { icon: FolderOpen, label: "Finder" },
  editor: { icon: Code2, label: "Editor" },
  simulator: { icon: Smartphone, label: "Simulator" },
};

export const CHIP = "flex items-center gap-1 rounded-lg border transition-all";

/**
 * T197/T204: what the pane can become in the launcher's folder (keys T, F, G, B, O, E), then the
 * folder's commands, pinned first and the rest behind "+N"; commands stay clicks
 */
export function FolderActions({
  projectId,
  folder,
  actions,
  labels,
  launching,
  compact,
  onAction,
  onCommand,
}: {
  projectId: string;
  folder: LauncherFolder;
  actions: LauncherAction[];
  /** The file manager's and editor's names */
  labels: { finder: string; editor: string };
  launching: string | null;
  compact: boolean;
  onAction: (action: LauncherAction) => void;
  onCommand: (label: string, command: string) => void;
}) {
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
  const [expanded, setExpanded] = useState(false);

  const pinSet = new Set(pins);
  const isPinned = (s: Script) => pinSet.has(pinKey(folder.rel, s.command));
  const pinned = folder.scripts.filter(isPinned);
  const rest = folder.scripts.filter((s) => !isPinned(s));
  const shown = expanded ? rest : rest.slice(0, Math.max(0, VISIBLE_COMMANDS - pinned.length));
  const hidden = rest.length - shown.length;
  const size = compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1 text-[11px]";
  const button = cn(
    CHIP,
    size,
    "border-border bg-bg-secondary text-text-secondary hover:border-accent/50",
  );

  return (
    <div className="flex max-w-full flex-col items-center gap-1.5">
      <div className="flex max-w-full flex-wrap justify-center gap-1">
        {actions.map((action) => {
          const { icon: Icon } = ACTION_META[action];
          const label =
            action === "finder"
              ? labels.finder
              : action === "editor"
                ? labels.editor
                : ACTION_META[action].label;
          return (
            <button
              key={action}
              type="button"
              disabled={action === "terminal" && !!launching}
              onClick={() => onAction(action)}
              className={button}
              title={`${label} in ${folder.path} (${LAUNCHER_ACTION_KEYS[action]})`}
            >
              <Icon className="h-3 w-3" />
              {label}
              {!compact && (
                <Kbd className="h-4 min-w-4 px-1 text-[9px]">{LAUNCHER_ACTION_KEYS[action]}</Kbd>
              )}
            </button>
          );
        })}
      </div>
      {folder.scripts.length > 0 && (
        <div className="flex max-w-full flex-wrap justify-center gap-1">
          {[...pinned, ...shown].map((s) => {
            const key = pinKey(folder.rel, s.command);
            const on = pinSet.has(key);
            const runner = runnerLabel(s);
            const Icon = s.source === "convex" ? Zap : Play;
            return (
              <span
                key={key}
                className={cn(
                  CHIP,
                  "group border-border bg-bg-secondary",
                  launching === s.name && "opacity-50",
                )}
              >
                <button
                  type="button"
                  disabled={!!launching}
                  onClick={() => onCommand(s.name, s.command)}
                  title={s.command}
                  className={cn(
                    "flex items-center gap-1 text-text-secondary hover:text-text-primary",
                    size,
                    "pr-0",
                  )}
                >
                  <Icon className={cn("h-3 w-3", s.source === "convex" && "text-amber-400")} />
                  {s.name}
                  {runner && !compact && (
                    <span className="text-[9px] text-text-muted">({runner})</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => togglePin.mutate(key)}
                  className={cn(
                    "px-1 text-text-muted hover:text-amber-400",
                    on ? "text-amber-400" : "opacity-0 group-hover:opacity-100",
                  )}
                  title={on ? "Unpin" : "Pin to the front"}
                >
                  <Star className="h-2.5 w-2.5" fill={on ? "currentColor" : "none"} />
                </button>
              </span>
            );
          })}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={cn(
                CHIP,
                size,
                "border-dashed border-border text-text-muted hover:text-text-secondary",
              )}
            >
              +{hidden}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
