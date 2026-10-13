import { endedFocusAllowed, type FocusTarget, isTextField } from "./ended-session";
import { appKeys, editKeys, hasClickModifier, IS_MAC } from "./keymap";

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

export type LauncherKey =
  | { action: LauncherAction }
  | { agentIndex: number }
  | { commandIndex: number }
  | { folder: true };

type KeyInput = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
>;

/** Option+1..9 (Alt+1..9 off macOS), read from e.code: the layout's Option or AltGr character
 *  never matters. Ctrl or Cmd also down is not it (AltGr on Windows is Ctrl+Alt; macOS takes
 *  Ctrl+1..9 for Spaces) */
function commandDigit(e: KeyInput): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
  return digit ? Number(digit) : null;
}

/** "⌥1" on macOS, "Alt+1" elsewhere */
export function commandBadge(n: number, mac = IS_MAC): string {
  return mac ? `⌥${n}` : appKeys(`Option+${n}`, false);
}

/**
 * A launcher key with no field typing: 1-9 agents in grid order, letters the pane actions,
 * Option+1..9 (Alt) the folder's commands, / or Cmd+F (Ctrl+F off macOS) the folder filter.
 * Plain keys are the same on every OS; never a held key's repeats
 */
export function launcherKeyAction(
  e: KeyInput,
  typing: boolean,
  counts: { actions: LauncherAction[]; agents: number; commands: number },
  mac = IS_MAC,
): LauncherKey | null {
  if (typing || e.repeat) return null;
  const n = commandDigit(e);
  if (n !== null) return n <= counts.commands ? { commandIndex: n - 1 } : null;
  const key = e.key.toLowerCase();
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) {
    // editKeys("Cmd+F"): Cmd alone on macOS, Ctrl alone elsewhere
    const only = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    return only && key === "f" && !e.shiftKey ? { folder: true } : null;
  }
  if (key === "/") return { folder: true };
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < counts.agents ? { agentIndex: index } : null;
  }
  const action = KEY_TO_ACTION[key];
  return action && counts.actions.includes(action) ? { action } : null;
}

/** The folder filter's chord for this platform's labels */
export const folderFilterKeys = (mac = IS_MAC) => editKeys("Cmd+F", mac);

/** A form key: Esc goes back to the grid; Enter (no Shift, not mid-composition) or Cmd+Enter
 *  (Ctrl+Enter off macOS) launches; Enter on a button or a select keeps its own meaning */
export function launchFormKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing">,
  targetTag: string,
  mac = IS_MAC,
): "back" | "launch" | null {
  if (e.key === "Escape") return "back";
  if (e.key !== "Enter" || e.isComposing || e.altKey) return null;
  if (hasClickModifier(e, mac)) return "launch";
  if (e.shiftKey || e.metaKey || e.ctrlKey) return null;
  const tag = targetTag.toUpperCase();
  return tag === "BUTTON" || tag === "SELECT" ? null : "launch";
}

interface Script {
  command: string;
}

export const pinKey = (rel: string, command: string) => `${rel}\u0000${command}`;

/** A folder's commands in shortcut order: pinned first, then as detected */
export function orderedCommands<T extends Script>(scripts: T[], pins: string[], rel: string): T[] {
  const pinned = new Set(pins);
  const isPinned = (s: T) => pinned.has(pinKey(rel, s.command));
  return [...scripts.filter(isPinned), ...scripts.filter((s) => !isPinned(s))];
}
