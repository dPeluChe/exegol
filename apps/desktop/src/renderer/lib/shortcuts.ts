import { appKeys, IS_MAC } from "./keymap";
/**
 * Every in-app shortcut, one list for Settings > Shortcuts and the Cmd+/ overlay (the three
 * copies had drifted from what use-hotkeys.ts does). Keep in step with hooks/use-hotkeys.ts.
 */
export type ShortcutCategory = "navigation" | "agents" | "terminal";

interface Shortcut {
  id: string;
  label: string;
  description: string;
  /** macOS notation; SHORTCUTS renders it for the running platform (lib/keymap) */
  keys: string;
  /** Linux/Windows keys when the Cmd → Ctrl+Shift rule does not say it best */
  otherKeys?: string;
  category: ShortcutCategory;
}

const MAC_SHORTCUTS: Shortcut[] = [
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    description: "Show or hide the sidebar",
    keys: "Cmd+B",
    category: "navigation",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Open the Settings window",
    keys: "Cmd+,",
    category: "navigation",
  },
  {
    id: "palette",
    label: "Command Palette",
    description: "Search commands, projects and agents",
    keys: "Cmd+K / Cmd+Shift+P",
    otherKeys: "Ctrl+Shift+K / Ctrl+Shift+P",
    category: "navigation",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Open the Dashboard",
    keys: "Cmd+1",
    category: "navigation",
  },
  {
    id: "project-n",
    label: "Project N",
    description:
      "A project as you left it: a number set in Edit project first, then projects with live sessions in the sidebar's order, all-pinned last",
    keys: "Cmd+2-9, Cmd+0",
    category: "navigation",
  },
  {
    id: "workspace-tab-n",
    label: "Workspace Tab N",
    description: "This project's tab by position",
    keys: "Cmd+Option+1-9",
    category: "navigation",
  },
  {
    id: "next-tab",
    label: "Next Tab",
    description: "Next tab of this project",
    keys: "Cmd+Shift+]",
    category: "navigation",
  },
  {
    id: "prev-tab",
    label: "Previous Tab",
    description: "Previous tab of this project",
    keys: "Cmd+Shift+[",
    category: "navigation",
  },
  {
    id: "pane-switcher",
    label: "Switch Pane",
    description:
      "Hold Ctrl and press Tab to pick any tab or pane of this project (Tab / Shift+Tab move, Esc cancels); a quick press goes back to the previous pane",
    keys: "Ctrl+Tab",
    category: "navigation",
  },
  {
    id: "next-pane",
    label: "Next / Previous Pane",
    description: "Move the cursor to the next pane of this tab, or back",
    keys: "Cmd+] / Cmd+[",
    category: "navigation",
  },
  {
    id: "next-attention",
    label: "Next Attention",
    description: "Jump to the next agent waiting on you",
    keys: "Cmd+J",
    category: "navigation",
  },
  {
    id: "help",
    label: "Shortcuts Help",
    description: "Show this list over the workspace",
    keys: "Cmd+/",
    category: "navigation",
  },
  {
    id: "new-agent",
    label: "New Agent",
    description: "Open the launch dialog",
    keys: "Cmd+N",
    category: "agents",
  },
  {
    id: "parallel",
    label: "Parallel Spawn",
    description: "Launch several agents on the same task",
    keys: "Cmd+Shift+N",
    category: "agents",
  },
  {
    id: "stop-agent",
    label: "Stop Agent",
    description: "Stop the focused agent",
    keys: "Cmd+.",
    category: "agents",
  },
  {
    id: "new-tab",
    label: "New Tab",
    description: "New workspace tab",
    keys: "Cmd+T",
    category: "terminal",
  },
  {
    id: "close-pane",
    label: "Close Pane / Tab",
    description: "Close the focused pane (the tab if it is the last) and stop its agent",
    keys: "Cmd+W",
    category: "terminal",
  },
  {
    id: "browser-address",
    label: "Browser: Address Bar",
    description: "Select the focused browser pane's address (the floating browser's too)",
    keys: "Cmd+L",
    category: "terminal",
  },
  {
    id: "browser-reload",
    label: "Browser: Reload Page",
    description: "Reload the focused browser pane's page; elsewhere Cmd+R reloads the window",
    keys: "Cmd+R",
    category: "terminal",
  },
  {
    id: "split-h",
    label: "Split Horizontal",
    description: "New pane to the right",
    keys: "Cmd+D",
    category: "terminal",
  },
  {
    id: "split-v",
    label: "Split Vertical",
    description: "New pane below",
    keys: "Cmd+Shift+D",
    category: "terminal",
  },
  {
    id: "dictation",
    label: "Dictation",
    description:
      "Speak into the focused pane: press to start and again to insert, or hold while you talk (Esc cancels). Change it in Settings > Dictation",
    keys: "Cmd+Shift+Space",
    otherKeys: "Ctrl+Shift+Space",
    category: "terminal",
  },
];

/** "Cmd+Shift+D" in any modifier order → one comparable form */
function normalizeKeys(keys: string): string {
  const parts = keys.split("+");
  const key = parts.pop()?.toUpperCase() ?? "";
  return [...parts.sort(), key].join("+");
}

/** Every chord an app shortcut uses, ranges ("Cmd+2-9") expanded, macOS notation */
function appChords(): { chord: string; label: string }[] {
  return MAC_SHORTCUTS.filter((s) => s.id !== "dictation").flatMap((s) =>
    s.keys
      .split(/ \/ |, /)
      .flatMap((keys) => {
        const range = /^(.*\+)(\d)-(\d)$/.exec(keys);
        if (!range) return [keys];
        const [, prefix = "", from = "0", to = "0"] = range;
        return Array.from(
          { length: Number(to) - Number(from) + 1 },
          (_, i) => `${prefix}${Number(from) + i}`,
        );
      })
      .map((keys) => ({ chord: normalizeKeys(keys), label: s.label })),
  );
}

/** The app shortcut a dictation chord (stored notation) would take over, if any */
export function shortcutClash(keys: string): string | null {
  const wanted = normalizeKeys(keys);
  return appChords().find((c) => c.chord === wanted)?.label ?? null;
}

export const SHORTCUTS: Shortcut[] = MAC_SHORTCUTS.map((s) => ({
  ...s,
  keys: IS_MAC ? s.keys : (s.otherKeys ?? appKeys(s.keys)),
}));

/** "CommandOrControl+Shift+E" as the lists write keys. An Electron accelerator, so plain Ctrl
 *  off macOS (not the app's Ctrl+Shift) */
export function displayAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/g, IS_MAC ? "Cmd" : "Ctrl")
    .replace(/Command|Cmd/g, "Cmd")
    .replace(/Control/g, "Ctrl")
    .replace(/Option/g, "Alt");
}
