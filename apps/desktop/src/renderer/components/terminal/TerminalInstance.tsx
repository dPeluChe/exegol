import { cn } from "@exegol/ui";
import type { FitAddon } from "@xterm/addon-fit";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useSettings } from "../../hooks/use-trpc";
import { fileDragToPaste, hasFileDragData } from "../../lib/file-drag";
import { termDbg } from "../../lib/term-debug";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import type { DormantPipe } from "./terminal-dormant-wiring";
import { fitAndSyncSize, fitMirror, setupTerminalSession } from "./terminal-setup";
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

/** Long enough that scrolling past a pane costs nothing; short enough that a
 *  backgrounded agent stops paying IPC almost immediately. */
const HIDE_DEBOUNCE_MS = 1_500;

/** Sessions already kicked by this renderer (see the mount kick) */
const kickedSessions = new Set<string>();

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
    mirror = false,
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
  // A mirror must not write cwd/exit state into the owning pane
  const paneId = useWorkspaceStore((s) =>
    mirror ? undefined : paneIdForAgentSelector(s, agentId, paneIdProp),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const webglRef = useRef<WebglController | null>(null);
  const dormantPipeRef = useRef<DormantPipe | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const viewId = useId();
  const reportedVisibleRef = useRef(false);
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
    // A mirror follows the PTY's grid (wired in setup) and only rescales its font
    if (mirror) fitMirror(terminal, fontSize, agentId);
    else fitAndSyncSize(terminal, fit, agentId, readOnly, (c, r) => setTerminalSize(agentId, c, r));
  }, [agentId, setTerminalSize, readOnly, mirror, fontSize]);

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
      mirror,
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

    const refit = () => {
      if (mirror) fitMirror(session.terminal, fontSize, agentId);
      else
        fitAndSyncSize(session.terminal, session.fitAddon, agentId, readOnly, (c, r) =>
          setTerminalSize(agentId, c, r),
        );
    };

    // Double-RAF: first frame settles layout, second fits terminal accurately
    requestAnimationFrame(() => {
      requestAnimationFrame(refit);
    });

    const settleTimer = setTimeout(refit, 150);

    // T155.4 SIGWINCH kick: alt-screen TUIs (opencode/devin/vim) reattach to
    // a black pane after window reload — the ring replay can't repaint an alt
    // screen, only the app can. Once per session per renderer: a pane that
    // remounts on a project switch doesn't need it (two redraws for nothing),
    // and a reload clears the set. Main does the jiggle without telling mirrors.
    const kickTimer = setTimeout(() => {
      if (readOnly || mirror || kickedSessions.has(agentId)) return;
      if (session.terminal.buffer.active.type !== "alternate") return;
      kickedSessions.add(agentId);
      termDbg(`kick:${agentId}:${viewId}`, "SIGWINCH kick", { agentId });
      window.api.terminal.redraw(agentId);
    }, 350);

    if (!mirror) setTerminalReady(agentId);
    onReady?.();

    let mirrorFitTimer: ReturnType<typeof setTimeout> | null = null;
    let observedWidth = -1;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? -1;
      termDbg(`ro:${agentId}:${viewId}`, "container resized", {
        agentId,
        viewId,
        mirror,
        box: `${Math.round(width)}x${Math.round(entry?.contentRect.height ?? -1)}`,
      });
      if (mirror) {
        // Its height follows its own font: only a WIDTH change is news. And a
        // drag changes width every frame; refit once it stops, since each font
        // step rebuilds the glyph atlas
        if (width === observedWidth) return;
        observedWidth = width;
        if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
        mirrorFitTimer = setTimeout(refit, 120);
        return;
      }
      // ResizeObserver already fires at most once per frame
      refit();
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(kickTimer);
      if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
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
    mirror,
    initialContent,
    isLight,
  ]);

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
    // Revealing costs a full serialize in main, so a pane flicking past during
    // a scroll must not pay for it. Hiding is debounced; showing is immediate,
    // because a late reveal is a visibly stale terminal.
    // viewId: main counts views, not windows, so a pane unmounting can't
    // silence its Overview mirror in the same window (T194)
    if (!isVisible) {
      const timer = setTimeout(() => {
        window.api.terminal.setVisible(agentId, false, viewId).catch(() => {});
      }, HIDE_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
    // The repaint arrives on terminal:data, in order with live output — this
    // call only reports. Acquire/release: unmounting while visible must release
    // too, or the view stays registered and the gate never engages again.
    termDbg(`vis:${agentId}:${viewId}`, "visible", { agentId, viewId, mirror, visible: true });
    // First report of this view: its mount already fetched a snapshot
    const fresh = !reportedVisibleRef.current;
    reportedVisibleRef.current = true;
    window.api.terminal.setVisible(agentId, true, viewId, fresh).catch(() => {});
    return () => {
      termDbg(`vis:${agentId}:${viewId}`, "visible", { agentId, viewId, mirror, visible: false });
      window.api.terminal.setVisible(agentId, false, viewId).catch(() => {});
    };
  }, [agentId, isVisible, viewId, mirror]);

  useEffect(() => {
    dormantPipeRef.current?.setVisible(isVisible);
  }, [isVisible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cliType is stable per terminal instance
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    // Mirrors draw on canvas: several open at once would eat into Chromium's
    // ~16 WebGL contexts, and each one rebuilds its atlas on every font fit
    const useCanvas = mirror || (cliType && CANVAS_ONLY_CLI_TYPES.has(cliType));
    if (isVisible && !webglRef.current && !useCanvas) {
      const controller = createWebglController(terminal);
      controller.attach();
      webglRef.current = controller;
    } else if (!isVisible && webglRef.current) {
      // Debounced like the IPC hide: scrolling past must not tear down and
      // rebuild a GL context and its glyph atlas every time
      const timer = setTimeout(() => {
        webglRef.current?.dispose();
        webglRef.current = null;
      }, HIDE_DEBOUNCE_MS);
      return () => clearTimeout(timer);
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
      if (!terminal || !fit || mirror) return;
      try {
        handleResize();
        if (!readOnly) window.api.terminal.redraw(agentId);
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* not ready */
      }
    };
    window.addEventListener("exegol:kick-terminal", handleKick);
    return () => window.removeEventListener("exegol:kick-terminal", handleKick);
  }, [agentId, mirror, readOnly, handleResize]);

  useEffect(() => {
    const handleWindowResize = () => handleResize();
    const handleRefit = () => {
      const fit = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (!fit || !terminal) return;
      if (mirror) {
        handleResize();
        return;
      }
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
  }, [handleResize, mirror]);

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
        // A mirror sizes to its content: rows × the scaled cell height
        "terminal-container w-full bg-bg-primary",
        // Clipped, so a grid momentarily taller than its box can never push the
        // box (and with it the next fit) taller
        !mirror && "h-full overflow-hidden",
        isDragOver && "ring-2 ring-inset ring-accent/60",
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    />
  );
});
