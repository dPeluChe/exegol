import {
  Bot,
  Compass,
  Cuboid,
  Layout,
  type LucideIcon,
  MoveRight,
  PanelLeft,
  Plus,
  RotateCcw,
  Settings,
  Split,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { closeActivePane, reopenClosed } from "../lib/close-target";
import { movePane, paneMoveTargets } from "../lib/move-pane";
import { SIDEBAR_VIEW_META } from "../lib/sidebar-views";
import {
  addTabAndFocus,
  openTerminalHere,
  splitActivePane,
  splitActiveWithTerminal,
} from "../lib/split-terminal";
import { jumpToAgent, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { selectActivePaneId, selectPanes, useWorkspaceStore } from "../stores/workspace";

// ─── Types ────────���─────────────────────────────────────────────────────────

export type CommandCategory = "navigation" | "workspace" | "agent" | "project" | "search";

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  icon: LucideIcon;
  shortcut?: string;
  action: () => void;
}

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: "Navigation",
  workspace: "Workspace",
  agent: "Agents",
  project: "Projects",
  search: "Search Results",
};

// ─── Command Registry ───────────────────────────────────────────────────────

/** "Move Pane to Tab: …" for the active pane, read when the palette opens */
function movePaneCommands(run: (fn: () => void) => () => void): Command[] {
  const paneId = selectActivePaneId(useWorkspaceStore.getState());
  if (!paneId) return [];
  return paneMoveTargets(paneId).map((target) => ({
    id: `ws:move-pane:${target.tabId}`,
    label: target.tabId === "new" ? "Move Pane to New Tab" : `Move Pane to Tab: ${target.label}`,
    category: "workspace",
    icon: MoveRight,
    action: run(() => movePane(paneId, target.tabId)),
  }));
}

export function useCommands(close: () => void, open: boolean): Command[] {
  const agents = useAgentStore((s) => s.agents);
  const emptyPane = useWorkspaceStore((s) => {
    const paneId = selectActivePaneId(s);
    return !!paneId && selectPanes(s)[paneId]?.type === "empty";
  });

  return useMemo(() => {
    const run = (fn: () => void) => () => {
      fn();
      close();
    };

    const cmds: Command[] = [
      // Navigation
      {
        id: "nav:projects",
        label: "Go to Projects",
        category: "navigation",
        icon: Cuboid,
        shortcut: "⌘⇧P",
        action: run(() => useAppStore.getState().openProjects()),
      },
      {
        id: "nav:settings",
        label: "Open Settings",
        category: "navigation",
        icon: Settings,
        shortcut: "⌘,",
        action: run(() => window.api.settings.open()),
      },
      {
        id: "nav:sidebar",
        label: "Toggle Sidebar",
        category: "navigation",
        icon: PanelLeft,
        shortcut: "⌘B",
        action: run(() => useAppStore.getState().toggleSidebar()),
      },
      {
        id: "nav:sidebar-next",
        label: "Next Sidebar View",
        category: "navigation",
        icon: PanelLeft,
        shortcut: "⌘⇧B",
        action: run(() => useAppStore.getState().cycleSidebarView()),
      },
      ...SIDEBAR_VIEW_META.map(({ id, label, icon }) => ({
        id: `nav:sidebar-${id}`,
        label: `Show ${label} in Sidebar`,
        category: "navigation" as const,
        icon,
        action: run(() => useAppStore.getState().openSidebarView(id)),
      })),
      {
        id: "nav:welcome-tour",
        label: "Show welcome tour",
        category: "navigation",
        icon: Compass,
        action: run(() => useAppStore.getState().setWelcomeTourSeen(false)),
      },

      // Workspace
      {
        id: "ws:new-tab",
        label: "New Tab",
        category: "workspace",
        icon: Layout,
        shortcut: "⌘T",
        action: run(() => addTabAndFocus()),
      },
      {
        id: "ws:close-pane",
        label: "Close Pane",
        category: "workspace",
        icon: X,
        shortcut: "⌘W",
        // Same as Cmd+W: the pane's agent is stopped and archived, not left running unseen
        action: run(closeActivePane),
      },
      {
        id: "ws:reopen-closed",
        label: "Reopen Closed Tab",
        category: "workspace",
        icon: RotateCcw,
        shortcut: "⌘⇧T",
        action: run(() => reopenClosed()),
      },
      {
        id: "ws:split-h",
        label: "Split Horizontal",
        category: "workspace",
        icon: Split,
        shortcut: "⌘D",
        action: run(() => splitActivePane("horizontal")),
      },
      {
        id: "ws:split-v",
        label: "Split Vertical",
        category: "workspace",
        icon: Split,
        shortcut: "⌘⇧D",
        action: run(() => splitActivePane("vertical")),
      },

      {
        id: "ws:split-terminal",
        label: "New Terminal in Split",
        category: "workspace",
        icon: Terminal,
        shortcut: "⌘Y",
        action: run(() => void splitActiveWithTerminal()),
      },
      ...(emptyPane
        ? [
            {
              id: "ws:terminal-here",
              label: "Open Terminal Here",
              category: "workspace" as const,
              icon: Terminal,
              action: run(() => void openTerminalHere()),
            },
          ]
        : []),
      ...(open ? movePaneCommands(run) : []),

      // Agent commands
      {
        id: "agent:new",
        label: "New Agent",
        category: "agent",
        icon: Plus,
        shortcut: "⌘N",
        action: run(() => window.dispatchEvent(new CustomEvent("exegol:spawn-agent"))),
      },
      {
        id: "agent:stop",
        label: "Stop Focused Agent",
        category: "agent",
        icon: Square,
        action: run(() => useAgentStore.getState().stopFocusedAgent()),
      },

      // Dynamic: running agents
      ...Object.values(agents)
        .filter((a) => ["running", "waiting_input", "spawning"].includes(a.status))
        .map((a) => ({
          id: `agent:focus:${a.id}`,
          label: `${a.cliType}: ${a.taskDescription || a.id}`,
          category: "agent" as CommandCategory,
          icon: Bot,
          // Any project, any tab (it only looked in the active project's panes)
          action: run(() => jumpToAgent(a.id, a.projectId)),
        })),
    ];

    return cmds;
  }, [agents, close, emptyPane, open]);
}
