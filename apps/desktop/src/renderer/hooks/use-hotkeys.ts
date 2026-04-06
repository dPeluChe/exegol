import { useEffect } from "react";
import { useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { collectPaneIds, getProjectState, useWorkspaceStore } from "../stores/workspace";
import { deleteAgentImperative } from "./use-delete-agent";

export function useHotkeys() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setActiveView = useAppStore((s) => s.setActiveView);

  // Rule 4: external system sync — global keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab: cycle workspace tabs (works without Cmd)
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        navigateWorkspaceTab(e.shiftKey ? "prev" : "next");
        return;
      }

      const mod = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Win/Linux

      if (!mod) return;

      // Cmd+B: Toggle sidebar
      if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+T: New workspace tab
      if (e.key === "t") {
        e.preventDefault();
        useWorkspaceStore.getState().addTab();
        return;
      }

      // Cmd+W: Close focused pane (or tab if last pane) + stop terminal agents
      if (e.key === "w") {
        e.preventDefault();
        cleanupAndCloseFocusedPane();
        return;
      }

      // Cmd+,: Open Settings
      if (e.key === ",") {
        e.preventDefault();
        setActiveView("settings");
        return;
      }

      // Cmd+K or Cmd+Shift+P: Toggle Command Palette
      if (e.key === "k" || (e.shiftKey && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        const app = useAppStore.getState();
        app.setCommandPaletteOpen(!app.commandPaletteOpen);
        return;
      }

      // Cmd+Shift+D: Split vertical
      if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("exegol:split-pane", { detail: { direction: "vertical" } }),
        );
        return;
      }

      // Cmd+D: Split horizontal
      if (e.key === "d") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("exegol:split-pane", { detail: { direction: "horizontal" } }),
        );
        return;
      }

      // Cmd+N: New Agent (open spawn dialog)
      if (e.key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("exegol:spawn-agent"));
        return;
      }

      // Cmd+.: Stop focused agent
      if (e.key === ".") {
        e.preventDefault();
        const { focusedAgentId } = useAgentStore.getState();
        if (focusedAgentId) {
          window.dispatchEvent(
            new CustomEvent("exegol:stop-agent", {
              detail: { agentId: focusedAgentId },
            }),
          );
        }
        return;
      }

      // ── Workspace tab navigation (T42) ────────────────────────────────

      // Cmd+Shift+]: Next workspace tab
      if (e.shiftKey && e.key === "]") {
        e.preventDefault();
        navigateWorkspaceTab("next");
        return;
      }

      // Cmd+Shift+[: Previous workspace tab
      if (e.shiftKey && e.key === "[") {
        e.preventDefault();
        navigateWorkspaceTab("prev");
        return;
      }

      // Cmd+1-9: Switch to workspace tab by position
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        const index = Number.parseInt(e.key, 10) - 1;
        const tab = getProjectState().tabs[index];
        if (tab) {
          ws.setActiveTab(tab.id);
          if (useAppStore.getState().activeView !== "workspace") {
            setActiveView("workspace");
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, setActiveView]);
}

/** Stop agents in terminal panes, then close the focused pane/tab */
function cleanupAndCloseFocusedPane(): void {
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
  if (nextTab) setActiveTab(nextTab.id);
}
