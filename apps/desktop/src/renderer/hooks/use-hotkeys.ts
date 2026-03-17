import { useEffect } from "react";
import { type AgentState, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";

export function useHotkeys() {
  const setActiveView = useAppStore((s) => s.setActiveView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const _activeProjectId = useAppStore((s) => s.activeProjectId);
  const agents = Object.values(useAgentStore((s) => s.agents));
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Win/Linux

      if (!mod) return;

      // Cmd+B: Toggle sidebar
      if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+,: Open Settings
      if (e.key === ",") {
        e.preventDefault();
        setActiveView("settings");
        return;
      }

      // Cmd+Shift+P: Go to Projects
      if (e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        useAppStore.getState().setActiveProject(null);
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
        if (focusedAgentId) {
          window.dispatchEvent(
            new CustomEvent("exegol:stop-agent", {
              detail: { agentId: focusedAgentId },
            }),
          );
        }
        return;
      }

      // Cmd+]: Next tab (next agent)
      if (e.key === "]") {
        e.preventDefault();
        navigateAgentTab("next", agents, focusedAgentId, setFocusedAgent);
        return;
      }

      // Cmd+[: Previous tab (previous agent)
      if (e.key === "[") {
        e.preventDefault();
        navigateAgentTab("prev", agents, focusedAgentId, setFocusedAgent);
        return;
      }

      // Cmd+1-9: Switch to agent session by index (sidebar agents)
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < agents.length) {
          setFocusedAgent(agents[index]?.id ?? null);
          // Also switch to workspace view if not already there
          if (useAppStore.getState().activeView !== "workspace") {
            setActiveView("workspace");
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, setActiveView, agents, focusedAgentId, setFocusedAgent]);
}

function navigateAgentTab(
  direction: "next" | "prev",
  agents: AgentState[],
  focusedAgentId: string | null,
  setFocusedAgent: (id: string | null) => void,
) {
  if (agents.length === 0) return;
  if (!focusedAgentId) {
    setFocusedAgent(agents[0]?.id ?? null);
    return;
  }
  const currentIndex = agents.findIndex((a) => a.id === focusedAgentId);
  const nextIndex =
    direction === "next"
      ? (currentIndex + 1) % agents.length
      : (currentIndex - 1 + agents.length) % agents.length;
  setFocusedAgent(agents[nextIndex]?.id ?? null);
}
