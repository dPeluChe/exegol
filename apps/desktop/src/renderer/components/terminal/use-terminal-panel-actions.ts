import { type RefObject, useCallback, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import { useAgentStore } from "../../stores/agents";
import type { TerminalInstanceHandle } from "./terminal-types";
import { useTerminalUrlDetector } from "./use-terminal-url-detector";

type TerminalHandleRef = RefObject<TerminalInstanceHandle | null>;

/** T128: localhost URL detector → "Open preview" toolbar chip */
export function useLocalhostPreview(
  agentId: string,
  enabled: boolean,
  openBesideInBrowser: (url: string) => void,
) {
  const [previewUrl, dismissPreview] = useTerminalUrlDetector(agentId, enabled);
  const openPreview = useCallback(() => {
    if (!previewUrl) return;
    openBesideInBrowser(previewUrl);
    dismissPreview();
  }, [previewUrl, openBesideInBrowser, dismissPreview]);
  return { previewUrl, openPreview, dismissPreview };
}

/** Files beside the terminal for a quick look or a drag in, without touching the layout */
export function useFilesPeek(projectId: string | undefined) {
  const [filesOpen, setFilesOpen] = useState(false);
  const { data: peekProject } = useProject(filesOpen ? (projectId ?? null) : null);
  return {
    filesOpen,
    toggleFiles: () => setFilesOpen((v) => !v),
    closeFiles: () => setFilesOpen(false),
    peekProject,
  };
}

/** "Send to": the selection goes to a running agent in another pane */
export function useSendTo(agentId: string, terminalRef: TerminalHandleRef) {
  const [showSendTo, setShowSendTo] = useState(false);
  const allAgents = useAgentStore((s) => s.agents);

  /** Running agents in other panes (targets for "Send to") */
  const sendTargets = Object.values(allAgents).filter(
    (a) => a.id !== agentId && ["running", "waiting_input"].includes(a.status),
  );

  const handleSendTo = useCallback(
    (targetId: string) => {
      const text = terminalRef.current?.getSelection();
      if (!text) return;
      window.api.terminal.write(targetId, text);
      setShowSendTo(false);
    },
    [terminalRef],
  );

  return { sendTargets, showSendTo, setShowSendTo, handleSendTo };
}

/** Terminal/Chat toggle; the live chat view reads a snapshot taken when it opens */
export function useLiveViewMode(terminalRef: TerminalHandleRef) {
  const [viewMode, setViewMode] = useState<"terminal" | "chat">("terminal");
  const [liveSnapshot, setLiveSnapshot] = useState("");

  const toggleLiveView = useCallback(() => {
    if (viewMode === "terminal") {
      setLiveSnapshot(terminalRef.current?.serialize() ?? "");
      setViewMode("chat");
    } else {
      setViewMode("terminal");
    }
  }, [viewMode, terminalRef]);

  return { viewMode, setViewMode, liveSnapshot, toggleLiveView };
}
