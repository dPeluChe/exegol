import { useEffect } from "react";
import { focusAddressBar } from "../lib/address-bar";
import { closeActivePane, reopenClosed } from "../lib/close-target";
import { appChord, chordKey, IS_MAC } from "../lib/keymap";
import { goToShortcut } from "../lib/live-tabs";
import { cyclePane, focusActivePane, paneRoot } from "../lib/pane-focus";
import { trpcMutate } from "../lib/trpc-client";
import { jumpToAgent, sortAttentionItems, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { getActivePaneId, getProjectState, useWorkspaceStore } from "../stores/workspace";

export function useHotkeys() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setActiveView = useAppStore((s) => s.setActiveView);

  // Rule 4: external system sync — global keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      // Cmd+Shift+T: reopen the last closed tab or pane; Cmd+T: new workspace tab
      if (key === "t") {
        e.preventDefault();
        if (chord.shift) void reopenClosed();
        else useWorkspaceStore.getState().addTab();
        return;
      }

      // Cmd+L / Cmd+R on a focused browser pane: its address bar / its page (macOS gets them
      // through the app menu, which also fires while the page itself has the focus)
      if (key === "l" && focusBrowserAddress()) {
        e.preventDefault();
        return;
      }
      if (key === "r" && focusedBrowserPaneId()) {
        e.preventDefault();
        reloadFocusedBrowserOrWindow();
        return;
      }

      // Cmd+W: Close focused pane (or tab if last pane) + stop terminal agents
      if (key === "w") {
        e.preventDefault();
        void closeActivePane();
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
        stopActiveAgent();
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

      // Cmd+1: Dashboard; Cmd+2-9, 0: a project, as it was left (lib/live-tabs)
      if (digit && !chord.alt && !chord.shift) {
        e.preventDefault();
        if (digit === "1") {
          useAppStore.getState().openDashboard();
          return;
        }
        const flash = goToShortcut(digit);
        if (flash) {
          focusActivePane();
          window.dispatchEvent(new CustomEvent("exegol:live-tab-flash", { detail: flash }));
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
        void closeActivePane();
      } else if (action === "reload") {
        reloadFocusedBrowserOrWindow();
      } else if (action === "focus-location") {
        focusBrowserAddress();
      } else if (action === "open-dashboard") {
        useAppStore.getState().openDashboard();
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsubMenu();
    };
  }, [toggleSidebar, setActiveView]);
}

/** Cmd+.: the session in the active tab's focused pane, never one in a tab not on screen */
function stopActiveAgent(): void {
  if (useAppStore.getState().activeView !== "workspace") {
    useAgentStore.getState().stopFocusedAgent();
    return;
  }
  const paneId = getActivePaneId();
  const agentId = paneId ? getProjectState().panes[paneId]?.agentId : undefined;
  if (agentId) trpcMutate("agents.stop", { id: agentId }).catch(() => {});
}

/** The browser pane on screen with focus, if that is what has it */
function focusedBrowserPaneId(): string | null {
  const paneId = getActivePaneId();
  const pane = paneId ? getProjectState().panes[paneId] : undefined;
  return useAppStore.getState().activeView === "workspace" && pane?.type === "browser"
    ? pane.id
    : null;
}

function focusBrowserAddress(): boolean {
  const paneId = focusedBrowserPaneId();
  const root = paneId && paneRoot(paneId);
  return !!root && focusAddressBar(root);
}

/** Cmd+R: the page of the browser pane on screen with focus, else the window as before */
function reloadFocusedBrowserOrWindow(): void {
  const paneId = focusedBrowserPaneId();
  if (paneId) {
    window.dispatchEvent(new CustomEvent("exegol:reload-pane", { detail: { paneId } }));
    return;
  }
  window.location.reload();
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
