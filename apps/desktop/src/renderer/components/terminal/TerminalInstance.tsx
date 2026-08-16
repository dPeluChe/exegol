import { cn } from "@exegol/ui";
import type { FitAddon } from "@xterm/addon-fit";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useSettings } from "../../hooks/use-trpc";
import { fileDragToPaste, hasFileDragData } from "../../lib/file-drag";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import type { DormantPipe } from "./terminal-dormant-wiring";
import { fitAndSyncSize, setupTerminalSession } from "./terminal-setup";
import {
  CANVAS_ONLY_CLI_TYPES,
  DARK_BLACK_TERMINAL_THEME,
  DARK_TERMINAL_THEME,
  LIGHT_TERMINAL_THEME,
  type TerminalInstanceHandle,
  type TerminalInstanceProps,
} from "./terminal-types";
import { createWebglController, type WebglController } from "./terminal-webgl";

export type { TerminalInstanceHandle, TerminalInstanceProps } from "./terminal-types";

function paneIdForAgentSelector(
  state: ReturnType<typeof useWorkspaceStore.getState>,
  agentId: string,
  fallback: string | undefined,
): string | undefined {
  if (fallback) return fallback;
  for (const pw of Object.values(state.projectWorkspaces)) {
    for (const [id, pane] of Object.entries(pw.panes)) {
      if (pane.agentId === agentId) return id;
    }
  }
  return undefined;
}

export const TerminalInstance = forwardRef(function TerminalInstance(
  {
    agentId,
    cliType,
    readOnly = false,
    liveFeed = false,
    initialContent,
    onReady,
    onScrollPosition,
    onOpenFileLink,
    onOpenUrlInPane,
    paneId: paneIdProp,
  }: TerminalInstanceProps,
  ref: ForwardedRef<TerminalInstanceHandle>,
) {
  // paneIdProp lets parents (e.g. floating windows) override the lookup.
  // The normal flow falls back to a workspace-store search by agentId so
  // we don't force TerminalPanel (owned by WT4) to plumb the paneId.
  const paneId = useWorkspaceStore((s) => paneIdForAgentSelector(s, agentId, paneIdProp));
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const webglRef = useRef<WebglController | null>(null);
  const dormantPipeRef = useRef<DormantPipe | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  useImperativeHandle(ref, () => ({
    serialize: () => {
      const addon = serializeAddonRef.current;
      const terminal = terminalRef.current;
      if (!addon || !terminal) return null;
      try {
        return addon.serialize({ excludeAltBuffer: true, excludeModes: true });
      } catch {
        return null;
      }
    },
    refit: () => {
      const fit = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (!fit || !terminal) return;
      try {
        fit.fit();
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* container may not be ready */
      }
    },
    scrollToTop: () => terminalRef.current?.scrollToTop(),
    scrollToBottom: () => terminalRef.current?.scrollToBottom(),
    getSelection: () => terminalRef.current?.getSelection() ?? "",
    clear: () => terminalRef.current?.clear(),
  }));

  const setTerminalReady = useTerminalStore((s) => s.setTerminalReady);
  const setTerminalSize = useTerminalStore((s) => s.setTerminalSize);
  const setPaneCwd = useWorkspaceStore((s) => s.setPaneCwd);
  const setPaneLastExit = useWorkspaceStore((s) => s.setPaneLastExit);
  const { data: settings } = useSettings();

  const fontSize = settings?.terminalFontSize ?? 14;
  const fontFamily = settings?.terminalFontFamily ?? "Menlo, Monaco, monospace";
  const theme = settings?.theme ?? "dark";
  const isLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  const terminalTheme = isLight
    ? LIGHT_TERMINAL_THEME
    : theme === "dark-black"
      ? DARK_BLACK_TERMINAL_THEME
      : DARK_TERMINAL_THEME;

  const handleResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal) return;
    fitAndSyncSize(terminal, fit, agentId, readOnly, (cols, rows) =>
      setTerminalSize(agentId, cols, rows),
    );
  }, [agentId, setTerminalSize, readOnly]);

  // Rule 4: external system sync — xterm.js setup/teardown, PTY wiring, resize observer
  // biome-ignore lint/correctness/useExhaustiveDependencies: onScrollPosition is stable (useCallback), adding it would remount the entire terminal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const session = setupTerminalSession(container, {
      agentId,
      paneId,
      cliType,
      readOnly,
      liveFeed,
      initialContent,
      fontSize,
      fontFamily,
      theme: terminalTheme,
      onScrollPosition,
      onOpenFileLink,
      onOpenUrlInPane,
      setPaneCwd,
      setPaneLastExit,
    });

    terminalRef.current = session.terminal;
    fitAddonRef.current = session.fitAddon;
    serializeAddonRef.current = session.serializeAddon;
    dormantPipeRef.current = session.dormantPipe;

    const sync = (cols: number, rows: number) => setTerminalSize(agentId, cols, rows);

    // Double-RAF: first frame settles layout, second fits terminal accurately
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAndSyncSize(session.terminal, session.fitAddon, agentId, readOnly, sync);
      });
    });

    const settleTimer = setTimeout(() => {
      fitAndSyncSize(session.terminal, session.fitAddon, agentId, readOnly, sync);
    }, 150);

    // T155.4 SIGWINCH kick: alt-screen TUIs (opencode/devin/vim) reattach to
    // a black pane after window reload — the ring replay can't repaint an alt
    // screen, only the app can. A one-shot resize jiggle forces the redraw.
    let kickTimer2: ReturnType<typeof setTimeout> | null = null;
    const kickTimer = setTimeout(() => {
      if (readOnly) return;
      const t = session.terminal;
      if (t.cols < 3) return;
      window.api.terminal.resize(agentId, t.cols - 1, t.rows);
      kickTimer2 = setTimeout(() => window.api.terminal.resize(agentId, t.cols, t.rows), 60);
    }, 350);

    setTerminalReady(agentId);
    onReady?.();

    let resizeRaf: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        fitAndSyncSize(session.terminal, session.fitAddon, agentId, readOnly, sync);
      });
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(kickTimer);
      if (kickTimer2) clearTimeout(kickTimer2);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      // WebGL context must be freed before the terminal itself is torn down.
      webglRef.current?.dispose();
      webglRef.current = null;
      // session.dispose() unsubscribes onData/onScroll/OSC handlers + the
      // dormant ring pipe (T115) before xterm's own teardown runs.
      session.dispose();
      // T143 disposal audit: FitAddon/WebLinksAddon/SerializeAddon are not
      // disposed individually — xterm.js's Terminal.dispose() disposes every
      // addon still registered via its internal addon manager. Explicit here
      // so this isn't mistaken for a leak on a future audit.
      session.terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
      dormantPipeRef.current = null;
    };
  }, [
    agentId,
    paneId,
    setTerminalReady,
    setTerminalSize,
    setPaneCwd,
    setPaneLastExit,
    onReady,
    fontFamily,
    fontSize,
    readOnly,
    liveFeed,
    initialContent,
    isLight,
  ]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      terminalRef.current.options.fontFamily = fontFamily;
      fitAddonRef.current?.fit();
    }
  }, [fontSize, fontFamily]);

  // T38: visibility observer — drives WebGL attach/detach + T115 dormant ring
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.01 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Route visibility changes to the dormant pipe so hidden writes get
  // buffered into the ring and replayed on un-hide (T115).
  // T178: tell main whether this view can draw, so it stops shipping bytes
  // across IPC to a pane nobody is looking at. When output was dropped while
  // hidden, main answers with a snapshot and we repaint from it — resuming
  // mid-stream would paint onto a screen the app has already moved past.
  useEffect(() => {
    let cancelled = false;
    window.api.terminal
      .setVisible(agentId, isVisible)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const terminal = terminalRef.current;
        if (!terminal) return;
        terminal.reset();
        terminal.write(snapshot);
      })
      .catch(() => {
        /* main is gone or the channel is unavailable — the gate fails open */
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, isVisible]);

  useEffect(() => {
    dormantPipeRef.current?.setVisible(isVisible);
  }, [isVisible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cliType is stable per terminal instance
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const useCanvas = cliType && CANVAS_ONLY_CLI_TYPES.has(cliType);
    if (isVisible && !webglRef.current && !useCanvas) {
      const controller = createWebglController(terminal);
      controller.attach();
      webglRef.current = controller;
    } else if (!isVisible && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, [isVisible]);

  // T155 (verify session): manual "Refresh Terminal" from the pane menu —
  // refit + SIGWINCH jiggle + repaint, for TUIs stuck black after reload.
  useEffect(() => {
    const handleKick = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (detail?.agentId !== agentId) return;
      const terminal = terminalRef.current;
      const fit = fitAddonRef.current;
      if (!terminal || !fit) return;
      try {
        fit.fit();
        if (!readOnly && terminal.cols > 2) {
          window.api.terminal.resize(agentId, terminal.cols - 1, terminal.rows);
          setTimeout(() => {
            window.api.terminal.resize(agentId, terminal.cols, terminal.rows);
          }, 60);
        }
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* not ready */
      }
    };
    window.addEventListener("exegol:kick-terminal", handleKick);
    return () => window.removeEventListener("exegol:kick-terminal", handleKick);
  }, [agentId, readOnly]);

  useEffect(() => {
    const handleWindowResize = () => handleResize();
    const handleRefit = () => {
      const fit = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (!fit || !terminal) return;
      try {
        fit.fit();
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* not ready */
      }
    };
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("exegol:refit-terminals", handleRefit);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("exegol:refit-terminals", handleRefit);
    };
  }, [handleResize]);

  // T155: drop a file (from FileExplorer/GitPane) → paste as @path mention
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (readOnly || !hasFileDragData(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    },
    [readOnly],
  );
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      if (readOnly) return;
      const text = fileDragToPaste(e);
      if (!text) return;
      e.preventDefault();
      terminalRef.current?.paste(text);
      terminalRef.current?.focus();
    },
    [readOnly],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for file @mentions — xterm owns keyboard interaction
    <div
      ref={containerRef}
      className={cn(
        "terminal-container h-full w-full bg-bg-primary",
        isDragOver && "ring-2 ring-inset ring-accent/60",
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    />
  );
});
