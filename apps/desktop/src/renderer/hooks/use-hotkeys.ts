import { useEffect } from "react";
import { appChord, chordKey, IS_MAC } from "../lib/keymap";
import { groupForDigit } from "../lib/live-tabs";
import { cyclePane, focusActivePane } from "../lib/pane-focus";
import { jumpToAgent, sortAttentionItems, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { collectPaneIds, getProjectState, useWorkspaceStore } from "../stores/workspace";
import { deleteAgentImperative } from "./use-delete-agent";

export function useHotkeys() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setActiveView = useAppStore((s) => s.setActiveView);

  // Rule 4: external system sync — global keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab: next or previous pane of the tab (plain Tab stays with the
      // terminal; tabs cycle with Cmd+Shift+[ ])
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        cyclePane(e.shiftKey ? "prev" : "next");
        return;
      }

      // Cmd on macOS, Ctrl+Shift elsewhere (lib/keymap): Ctrl alone belongs to the terminal.
      // Below, "Cmd" and "Shift" read as that chord and its variant
      const chord = appChord(e);
      if (!chord) return;
      const key = chordKey(e);

      // Cmd+B: Toggle sidebar
      if (key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+T: New workspace tab
      if (key === "t") {
        e.preventDefault();
        useWorkspaceStore.getState().addTab();
        return;
      }

      // Cmd+W: Close focused pane (or tab if last pane) + stop terminal agents
      if (key === "w") {
        e.preventDefault();
        cleanupAndCloseFocusedPane();
        return;
      }

      // Cmd+,: Open Settings (separate BrowserWindow, T120)
      if (key === ",") {
        e.preventDefault();
        window.api.settings.open();
        return;
      }

      // Cmd+K or Cmd+Shift+P: Toggle Command Palette (Ctrl+Shift+P too, where the chord is Ctrl+Shift)
      if (key === "k" || (key === "p" && (chord.shift || !IS_MAC))) {
        e.preventDefault();
        const app = useAppStore.getState();
        app.setCommandPaletteOpen(!app.commandPaletteOpen);
        return;
      }

      // Cmd+Shift+D: Split vertical
      if (chord.shift && key === "d") {
        e.preventDefault();
        useWorkspaceStore.getState().splitFocusedPane("vertical");
        return;
      }

      // Cmd+D: Split horizontal
      if (key === "d") {
        e.preventDefault();
        useWorkspaceStore.getState().splitFocusedPane("horizontal");
        return;
      }

      // Cmd+Shift+N: Parallel spawn dialog (T65)
      if (chord.shift && key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("exegol:spawn-parallel"));
        return;
      }

      // Cmd+N: New Agent (open spawn dialog)
      if (key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("exegol:spawn-agent"));
        return;
      }

      // Cmd+.: Stop focused agent
      if (key === ".") {
        e.preventDefault();
        useAgentStore.getState().stopFocusedAgent();
        return;
      }

      // ── Workspace tab navigation (T42) ────────────────────────────────

      // Cmd+Shift+]: Next workspace tab
      if (chord.shift && key === "]") {
        e.preventDefault();
        navigateWorkspaceTab("next");
        return;
      }

      // Cmd+Shift+[: Previous workspace tab
      if (chord.shift && key === "[") {
        e.preventDefault();
        navigateWorkspaceTab("prev");
        return;
      }

      // Cmd+J: Jump to the next agent needing attention (T141)
      if (key === "j") {
        e.preventDefault();
        jumpToNextAttention();
        return;
      }

      // Cmd+/ (Cmd+?): Show keyboard shortcuts overlay
      if (key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("exegol:show-shortcuts"));
        return;
      }

      const digit = /^[0-9]$/.test(key) ? key : undefined;

      // Cmd+1: Dashboard; Cmd+2-9, 0: the live tab groups (numbers given in Edit project first,
      // then the sidebar's order, pinned ones last: lib/live-tabs)
      if (digit && !chord.alt && !chord.shift) {
        e.preventDefault();
        if (digit === "1") {
          useAppStore.getState().openDashboard();
          return;
        }
        const group = groupForDigit(digit);
        const first = group?.agentIds[0];
        if (group && first) {
          jumpToAgent(first, group.projectId);
          focusActivePane();
          window.dispatchEvent(new CustomEvent("exegol:live-tab-flash", { detail: group.key }));
        }
        return;
      }

      // Cmd+Option+1-9: workspace tab of the current project by position
      if (digit && digit !== "0" && chord.alt) {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        const index = Number(digit) - 1;
        const tab = getProjectState().tabs[index];
        if (tab) {
          ws.setActiveTab(tab.id);
          if (useAppStore.getState().activeView !== "workspace") {
            setActiveView("workspace");
          }
          focusActivePane();
        }
        return;
      }

      // Cmd+] / Cmd+[: next or previous pane of this tab (plain Tab belongs to the terminal:
      // shell completion, Claude). chordKey reads e.code: the bracket keys move on other layouts
      if (!chord.shift && (key === "]" || key === "[")) {
        e.preventDefault();
        cyclePane(key === "]" ? "next" : "prev");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Also listen for menu-driven actions from the macOS app menu. The
    // menu routes Cmd+W to "menu:close-pane" so the OS default "Close
    // Window" never fires.
    const unsubMenu = window.api.onMenuAction((action) => {
      if (action === "new-tab") {
        useWorkspaceStore.getState().addTab();
      } else if (action === "close-pane") {
        cleanupAndCloseFocusedPane();
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsubMenu();
    };
  }, [toggleSidebar, setActiveView]);
}

/** Stop agents in terminal panes, then close the focused pane/tab */
export function cleanupAndCloseFocusedPane(): void {
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();
  const { focusedPaneId } = ws;
  const { activeTabId, tabs, panes } = pw;
  if (!focusedPaneId || !activeTabId) return;

  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const allPaneIds = collectPaneIds(tab.layout);
  const isLastPane = allPaneIds.length <= 1;

  // Collect panes to clean up: if last pane → all panes in tab, otherwise just the focused one
  const paneIdsToClean = isLastPane ? allPaneIds : [focusedPaneId];

  for (const pid of paneIdsToClean) {
    const pane = panes[pid];
    if (pane?.type === "terminal" && pane.agentId) {
      deleteAgentImperative(pane.agentId);
    }
  }

  ws.closeFocusedPane();
}

/**
 * Jump to the next unread attention item (T141), cycling past the currently
 * focused agent so repeated presses walk the queue. Falls back to any item
 * (including already-read/pinned) if nothing is unread.
 */
function jumpToNextAttention(): void {
  const { attentionItems, focusedAgentId } = useAgentStore.getState();
  const queue = sortAttentionItems(Object.values(attentionItems));
  if (queue.length === 0) return;

  const unread = queue.filter((i) => !i.read);
  const pool = unread.length > 0 ? unread : queue;
  const currentIndex = pool.findIndex((i) => i.agentId === focusedAgentId);
  const next = pool[(currentIndex + 1) % pool.length];
  if (next) jumpToAgent(next.agentId, next.projectId);
}

/** Cycle through workspace tabs (next/prev) */
function navigateWorkspaceTab(direction: "next" | "prev"): void {
  const { setActiveTab } = useWorkspaceStore.getState();
  const { tabs, activeTabId } = getProjectState();
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  const nextIndex =
    direction === "next"
      ? (currentIndex + 1) % tabs.length
      : (currentIndex - 1 + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  if (nextTab) {
    setActiveTab(nextTab.id);
    focusActivePane();
  }
}
