/**
 * Every in-app shortcut, one list for Settings > Shortcuts and the Cmd+/ overlay (the three
 * copies had drifted from what use-hotkeys.ts does). Keep in step with hooks/use-hotkeys.ts.
 */
export type ShortcutCategory = "navigation" | "agents" | "terminal";

interface Shortcut {
  id: string;
  label: string;
  description: string;
  keys: string;
  category: ShortcutCategory;
}

export const SHORTCUTS: Shortcut[] = [
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
    id: "live-tab-n",
    label: "Live Tab N",
    description:
      "Tabs with live sessions: a number set in Edit project first, then the sidebar's order, pinned sessions last",
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
    id: "next-pane",
    label: "Next / Previous Pane",
    description: "Move the cursor to the next pane of this tab, or back (Shift, or [)",
    keys: "Ctrl+Tab / Ctrl+Shift+Tab (or Cmd+] / Cmd+[)",
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
];

/** "CommandOrControl+Shift+E" as the lists write keys */
export function displayAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl|Command|Cmd/g, "Cmd")
    .replace(/Control/g, "Ctrl")
    .replace(/Option/g, "Alt");
}
