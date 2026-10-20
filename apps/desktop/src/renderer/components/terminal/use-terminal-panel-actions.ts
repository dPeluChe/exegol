import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useProject } from "../../hooks/use-trpc";
import { sendToActive } from "./send-targets";
import type { TerminalInstanceHandle } from "./terminal-types";
import { registerSelectionSource, useSendSections } from "./use-send-to";
import { useTerminalUrlDetector } from "./use-terminal-url-detector";

type TerminalHandleRef = RefObject<TerminalInstanceHandle | null>;

const TUI_COPY_MS = 20_000;

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

/** "Send to": the selection goes into another live agent or terminal (SendToList sends it).
 *  With a pane, its right-click menu offers the same list (registerSelectionSource) */
export function useSendTo(
  agentId: string,
  projectId: string | undefined,
  terminalRef: TerminalHandleRef,
  paneId?: string,
) {
  const [showSendTo, setShowSendToState] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  // What the TUI copied from its own mouse selection (OSC 52): xterm holds none then
  const [tuiCopy, setTuiCopy] = useState<string | null>(null);
  const tuiCopyRef = useLatest(tuiCopy);
  const sendSections = useSendSections(
    agentId,
    projectId,
    sendToActive(hasSelection || tuiCopy !== null, showSendTo),
  );
  const getSelection = useCallback(
    () => terminalRef.current?.getSelection() || (tuiCopyRef.current ?? ""),
    [terminalRef, tuiCopyRef],
  );
  const setShowSendTo = useCallback((open: boolean) => {
    setShowSendToState(open);
    if (!open) setTuiCopy(null);
  }, []);

  useEffect(() => {
    if (!paneId) return;
    return registerSelectionSource(paneId, { agentId, projectId, getSelection });
  }, [paneId, agentId, projectId, getSelection]);

  // Offered while fresh: an unused copy goes away, an open list keeps it
  useEffect(() => {
    if (tuiCopy === null || showSendTo) return;
    const timer = window.setTimeout(() => setTuiCopy(null), TUI_COPY_MS);
    return () => window.clearTimeout(timer);
  }, [tuiCopy, showSendTo]);

  // An open list stays: a TUI's mouse mode or repaint clears xterm's selection under it, and the
  // list sends the text it opened with
  const onSelectionChange = useCallback((selected: boolean) => setHasSelection(selected), []);

  return {
    sendSections,
    showSendTo,
    setShowSendTo,
    onSelectionChange,
    onTuiCopy: setTuiCopy,
    getSelection,
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
