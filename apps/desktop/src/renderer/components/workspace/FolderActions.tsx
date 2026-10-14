import type { LauncherFolder } from "@exegol/shared";
import { cn } from "@exegol/ui";
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
import {
  commandBadge,
  LAUNCHER_ACTION_KEYS,
  type LauncherAction,
  orderedCommands,
  pinKey,
} from "../../lib/launcher";
import { Kbd } from "../common/Kbd";
import { useRunPins } from "./use-launcher-actions";

type Script = LauncherFolder["scripts"][number];

const VISIBLE_COMMANDS = 4;

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
 * folder's commands, pinned first and the rest behind "+N", the first nine on Option+1..9
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
  const { pins, togglePin } = useRunPins(projectId);
  const [expanded, setExpanded] = useState(false);

  const pinSet = new Set(pins);
  const commands = orderedCommands(folder.scripts, pins, folder.rel);
  const pinnedCount = commands.filter((s) => pinSet.has(pinKey(folder.rel, s.command))).length;
  const shown = expanded ? commands : commands.slice(0, Math.max(VISIBLE_COMMANDS, pinnedCount));
  const hidden = commands.length - shown.length;
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
              aria-label={label}
            >
              <Icon className="h-3 w-3" />
              <span className="@max-xs:hidden">{label}</span>
              <Kbd
                className={cn(
                  "h-4 min-w-4 px-1 text-[9px]",
                  compact && "hidden @max-xs:inline-flex",
                )}
              >
                {LAUNCHER_ACTION_KEYS[action]}
              </Kbd>
            </button>
          );
        })}
      </div>
      {folder.scripts.length > 0 && (
        <div className="flex max-w-full flex-wrap justify-center gap-1">
          {shown.map((s, i) => {
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
                  title={i < 9 ? `${s.command} (${commandBadge(i + 1)})` : s.command}
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
                  {i < 9 && !compact && (
                    <Kbd className="h-4 min-w-4 px-1 text-[9px]">{commandBadge(i + 1)}</Kbd>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => togglePin(key)}
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
