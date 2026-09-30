import { type RefObject, useCallback, useRef, useState } from "react";
import { useProject, useProjects } from "../../hooks/use-trpc";
import { pasteToAgent } from "../../lib/agent-input";
import { jumpToAgent, useAgentStore } from "../../stores/agents";
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
  /** A file picked in the panel, shown over the terminal */
  const [peekFile, setPeekFile] = useState<string | null>(null);
  const fileDirtyRef = useRef(false);
  const { data: peekProject } = useProject(filesOpen ? (projectId ?? null) : null);
  const closeFile = () => {
    fileDirtyRef.current = false;
    setPeekFile(null);
  };
  return {
    filesOpen,
    toggleFiles: () => setFilesOpen((v) => !v),
    closeFiles: () => {
      setFilesOpen(false);
      if (!fileDirtyRef.current) setPeekFile(null);
    },
    peekProject,
    peekFile,
    openFile: (path: string) => {
      fileDirtyRef.current = false;
      setPeekFile(path);
    },
    closeFile,
    setFileDirty: (dirty: boolean) => {
      fileDirtyRef.current = dirty;
    },
    /** Esc while the panel or a file is open: the file first, then the panel. False = not ours */
    escape: (): boolean => {
      if (peekFile) {
        // Unsaved edits stay: the file's own close asks first
        if (!fileDirtyRef.current) closeFile();
        return true;
      }
      if (filesOpen) {
        setFilesOpen(false);
        return true;
      }
      return false;
    },
  };
}

/** A live agent that can receive a selection, with the project it belongs to */
export interface SendTarget {
  id: string;
  name: string;
  cliType: string;
  projectId: string;
}

/** Live agents other than `selfId`, never shells, grouped by project: this project first,
 *  then the others by name */
export function groupSendTargets(
  agents: Array<{
    id: string;
    alias?: string | null;
    cliType: string;
    projectId: string;
    status: string;
  }>,
  selfId: string,
  projectNames: Map<string, string>,
  currentProjectId: string | undefined,
) {
  const targets: SendTarget[] = agents
    .filter(
      (a) =>
        a.id !== selfId &&
        a.cliType !== "shell" &&
        (a.status === "running" || a.status === "waiting_input"),
    )
    .map((a) => ({
      id: a.id,
      name: a.alias ?? a.cliType,
      cliType: a.cliType,
      projectId: a.projectId,
    }));
  const nameOf = (id: string) => projectNames.get(id) ?? id.slice(0, 8);
  return [...new Set(targets.map((t) => t.projectId))]
    .sort((a, b) =>
      a === currentProjectId ? -1 : b === currentProjectId ? 1 : nameOf(a).localeCompare(nameOf(b)),
    )
    .map((id) => ({
      projectId: id,
      projectName: nameOf(id),
      targets: targets.filter((t) => t.projectId === id),
    }));
}

/** "Send to": the selected text goes into another live agent's input (not submitted: the user
 *  adds context there). Only agents: pasting prose into a shell would run it line by line */
export function useSendTo(
  agentId: string,
  projectId: string | undefined,
  terminalRef: TerminalHandleRef,
) {
  const [showSendTo, setShowSendTo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const allAgents = useAgentStore((s) => s.agents);
  const { data: projects = [] } = useProjects();

  const groups = groupSendTargets(
    Object.values(allAgents),
    agentId,
    new Map(projects.map((p) => [p.id, p.name])),
    projectId,
  );

  const handleSendTo = useCallback(
    (target: SendTarget) => {
      const text = terminalRef.current?.getSelection();
      if (!text) return;
      pasteToAgent(target.id, text);
      setShowSendTo(false);
      jumpToAgent(target.id, target.projectId);
    },
    [terminalRef],
  );

  const onSelectionChange = useCallback((selected: boolean) => {
    setHasSelection(selected);
    if (!selected) setShowSendTo(false);
  }, []);

  return {
    sendGroups: hasSelection ? groups : [],
    showSendTo,
    setShowSendTo,
    handleSendTo,
    onSelectionChange,
  };
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
