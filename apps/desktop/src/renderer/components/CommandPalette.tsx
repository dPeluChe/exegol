import { Input } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bot,
  Compass,
  Cuboid,
  Keyboard,
  Layout,
  type LucideIcon,
  MoveRight,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  Split,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimulatorAvailable } from "../hooks/use-simulator";
import { closeActivePane, reopenClosed } from "../lib/close-target";
import { appKeys } from "../lib/keymap";
import { movePane, paneMoveTargets } from "../lib/move-pane";
import { SIDEBAR_VIEW_META } from "../lib/sidebar-views";
import { runCommandInNewTab } from "../lib/spawn-shell";
import {
  openSimulatorForActivePane,
  openTerminalHere,
  splitActiveWithTerminal,
} from "../lib/split-terminal";
import { trpcInvoke } from "../lib/trpc-client";
import { jumpToAgent, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { selectActivePaneId, selectPanes, useWorkspaceStore } from "../stores/workspace";

// ─── Types ────────���─────────────────────────────────────────────────────────

type CommandCategory = "navigation" | "workspace" | "agent" | "project" | "search";

interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  icon: LucideIcon;
  shortcut?: string;
  action: () => void;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
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

function useCommands(close: () => void, open: boolean): Command[] {
  const agents = useAgentStore((s) => s.agents);
  const emptyPane = useWorkspaceStore((s) => {
    const paneId = selectActivePaneId(s);
    return !!paneId && selectPanes(s)[paneId]?.type === "empty";
  });
  const simulator = useSimulatorAvailable();

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
        action: run(() => useWorkspaceStore.getState().addTab()),
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
        action: run(() => useWorkspaceStore.getState().splitFocusedPane("horizontal")),
      },
      {
        id: "ws:split-v",
        label: "Split Vertical",
        category: "workspace",
        icon: Split,
        shortcut: "⌘⇧D",
        action: run(() => useWorkspaceStore.getState().splitFocusedPane("vertical")),
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
      ...(simulator
        ? [
            {
              id: "ws:simulator",
              label: emptyPane ? "Open Simulator Here" : "New Simulator in Split",
              category: "workspace" as const,
              icon: Smartphone,
              action: run(openSimulatorForActivePane),
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
        shortcut: "⌘.",
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
  }, [agents, close, emptyPane, open, simulator]);
}

// ─── Fuzzy Filter ────────��──────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Project Search (async) ��────────────────────────────────────────────────

interface ProjectResult {
  id: string;
  name: string;
}

function useProjectSearch(query: string, close: () => void): Command[] {
  const [projects, setProjects] = useState<ProjectResult[]>([]);

  useEffect(() => {
    if (query.length < 2) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    trpcInvoke<ProjectResult[]>("projects.list").then((all) => {
      if (cancelled) return;
      setProjects(
        all.filter(
          (p) => p.name.toLowerCase().includes(query.toLowerCase()) || fuzzyMatch(query, p.name),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return useMemo(
    () =>
      projects.slice(0, 5).map((p) => ({
        id: `project:${p.id}`,
        label: p.name,
        category: "project" as CommandCategory,
        icon: Cuboid,
        action: () => {
          useAppStore.getState().setActiveProject(p.id);
          close();
        },
      })),
    [projects, close],
  );
}

// ─── Component ───────────────────────────────────────��──────────────────────

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, [setOpen]);

  const commands = useCommands(close, open);
  const projectResults = useProjectSearch(query, close);

  const filtered = useMemo(() => {
    const all = [...commands, ...projectResults];
    if (!query) return all.filter((c) => c.category !== "project");
    return all.filter((c) => fuzzyMatch(query, c.label));
  }, [commands, projectResults, query]);

  // Group by category for display
  const grouped = useMemo(() => {
    const groups: { category: CommandCategory; items: Command[] }[] = [];
    const seen = new Set<CommandCategory>();
    for (const cmd of filtered) {
      if (!seen.has(cmd.category)) {
        seen.add(cmd.category);
        groups.push({ category: cmd.category, items: [] });
      }
      groups.find((g) => g.category === cmd.category)?.items.push(cmd);
    }
    return groups;
  }, [filtered]);

  // Reset selection when query changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when selection changes
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector("[data-selected=true]");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // T96: Bang command — execute shell command when query starts with "!"
  const executeBangCommand = useCallback(
    async (cmd: string) => {
      const projectId = useAppStore.getState().activeProjectId;
      if (!projectId) return;
      close();
      try {
        await runCommandInNewTab(projectId, cmd);
      } catch (err) {
        console.error("[BangCommand] Failed:", err);
      }
    },
    [close],
  );

  const isBangCommand = query.startsWith("!");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        // T96: Bang command — ! prefix executes as shell
        if (isBangCommand && query.length > 1) {
          executeBangCommand(query.slice(1).trim());
        } else {
          filtered[selectedIndex]?.action();
        }
      }
    },
    [filtered, selectedIndex, isBangCommand, query, executeBangCommand],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
        else setOpen(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-[15%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          onKeyDown={handleKeyDown}
          aria-label="Command palette"
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>

          {/* Search input */}
          <div
            className="flex items-center gap-2 border-b px-3"
            style={{ borderColor: "var(--border)" }}
          >
            {isBangCommand ? (
              <Terminal className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Search className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
            )}
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command, search, or !shell-command..."
              className="h-11 border-0 bg-transparent text-sm shadow-none outline-none focus-visible:ring-0"
              style={{ color: "var(--text-primary)" }}
              autoFocus
            />
          </div>

          {/* T96: Bang command hint */}
          {isBangCommand && (
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-[11px] text-accent">
              <Terminal className="h-3.5 w-3.5" />
              <span>
                Press{" "}
                <kbd className="rounded border border-border bg-bg-tertiary px-1 text-[10px]">
                  Enter
                </kbd>{" "}
                to run in a new terminal tab
              </span>
            </div>
          )}

          {/* Results */}
          <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && !isBangCommand && (
              <div className="px-3 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No results found
              </div>
            )}

            {grouped.map((group) => {
              let globalIndex = 0;
              for (const g of grouped) {
                if (g.category === group.category) break;
                globalIndex += g.items.length;
              }

              return (
                <div key={group.category}>
                  <div
                    className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {CATEGORY_LABELS[group.category]}
                  </div>
                  {group.items.map((cmd, i) => {
                    const idx = globalIndex + i;
                    const isSelected = idx === selectedIndex;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        data-selected={isSelected}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          color: "var(--text-primary)",
                          background: isSelected ? "var(--bg-hover)" : "transparent",
                        }}
                        onClick={() => cmd.action()}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd
                            className="rounded px-1.5 py-0.5 text-xs"
                            style={{
                              background: "var(--bg-tertiary)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {appKeys(cmd.shortcut)}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div
            className="flex items-center justify-between border-t px-3 py-1.5 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <span>↑↓ navigate · ↵ select · esc close</span>
            <div className="flex items-center gap-1">
              <Keyboard className="h-3 w-3" />
              <span>{appKeys("⌘K")}</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
