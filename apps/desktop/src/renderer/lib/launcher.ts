import { endedFocusAllowed, type FocusTarget, isTextField } from "./ended-session";

/** What the empty pane's launcher opens in its folder, besides agents */
export type LauncherAction =
  | "terminal"
  | "files"
  | "git"
  | "browser"
  | "finder"
  | "editor"
  | "simulator";

export const LAUNCHER_ACTION_KEYS: Record<LauncherAction, string> = {
  terminal: "T",
  files: "F",
  git: "G",
  browser: "B",
  finder: "O",
  editor: "E",
  simulator: "S",
};

const KEY_TO_ACTION = Object.fromEntries(
  Object.entries(LAUNCHER_ACTION_KEYS).map(([action, key]) => [key.toLowerCase(), action]),
) as Record<string, LauncherAction>;

interface Folder {
  rel: string;
}

/** The pane's remembered folder while it still exists, else the project root (never a pinned
 *  command's folder: a project opens where it is) */
export function launcherFolder<T extends Folder>(
  folders: T[],
  remembered: string | undefined,
): T | undefined {
  return (
    folders.find((f) => f.rel === remembered) ?? folders.find((f) => f.rel === "") ?? folders[0]
  );
}

export const folderRowLabel = (f: Folder) => f.rel || "root";

/** The folder combobox's list for a query typed in its filter */
export function matchFolders<T extends Folder>(folders: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return folders;
  return folders.filter((f) => folderRowLabel(f).toLowerCase().includes(q));
}

/** The pane's actions in a folder: Git only in a repo (the root always: it may hold one), Editor
 *  only when one is installed, Simulator once that pane exists (T203) */
export function launcherActions(opts: {
  atRoot: boolean;
  git: boolean;
  editor: boolean;
  simulator?: boolean;
}): LauncherAction[] {
  const actions: LauncherAction[] = ["terminal", "files"];
  if (opts.atRoot || opts.git) actions.push("git");
  actions.push("browser", "finder");
  if (opts.editor) actions.push("editor");
  if (opts.simulator) actions.push("simulator");
  return actions;
}

export type LauncherKey = { action: LauncherAction } | { agentIndex: number } | { folder: true };

type KeyInput = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
>;

/** A launcher key with no field typing: 1-9 agents in grid order, letters the pane actions, / or
 *  Cmd+F (Ctrl+F) the folder filter. Never a held key's repeats */
export function launcherKeyAction(
  e: KeyInput,
  typing: boolean,
  actions: LauncherAction[],
  agentCount: number,
): LauncherKey | null {
  if (typing || e.repeat || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return key === "f" && !e.shiftKey ? { folder: true } : null;
  if (key === "/") return { folder: true };
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < agentCount ? { agentIndex: index } : null;
  }
  const action = KEY_TO_ACTION[key];
  return action && actions.includes(action) ? { action } : null;
}

/** Keys need the keyboard nowhere (body) or in the pane, and no text field focused: the folder
 *  filter and the form's prompt take their own typing */
export function launcherFocusAllowed(
  active: FocusTarget | null,
  ctx: Parameters<typeof endedFocusAllowed>[1],
): boolean {
  if (active && active !== ctx.body && isTextField(active) && !active.closest(".xterm")) {
    return false;
  }
  return endedFocusAllowed(active, ctx);
}

/** A form key: Esc goes back to the grid, Enter (no Shift, not mid-composition) or Cmd+Enter
 *  launches; Enter on a button or a select keeps its own meaning */
export function launchFormKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing">,
  targetTag: string,
): "back" | "launch" | null {
  if (e.key === "Escape") return "back";
  if (e.key !== "Enter" || e.isComposing || e.altKey) return null;
  if (e.metaKey || e.ctrlKey) return "launch";
  if (e.shiftKey) return null;
  const tag = targetTag.toUpperCase();
  return tag === "BUTTON" || tag === "SELECT" ? null : "launch";
}
