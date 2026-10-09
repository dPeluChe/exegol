import type { FitAddon } from "@xterm/addon-fit";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useSettings } from "../../hooks/use-trpc";
import { useTerminalStore } from "../../stores/terminals";
import {
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import { trackMousePress } from "./mouse-release";
import {
  fitAndSyncSize,
  fitMirror,
  setupTerminalSession,
  type TerminalSession,
} from "./terminal-setup";
import {
  CANVAS_ONLY_CLI_TYPES,
  DARK_BLACK_TERMINAL_THEME,
  DARK_TERMINAL_THEME,
  LIGHT_TERMINAL_THEME,
  type TerminalInstanceProps,
} from "./terminal-types";
import { createWebglController, type WebglController } from "./terminal-webgl";
import { HIDE_DEBOUNCE_MS, useTerminalVisibility } from "./use-terminal-visibility";

/** Sessions already kicked by this renderer (see kickAltScreen) */
const kickedSessions = new Set<string>();

function resolveTerminalTheme(theme: string) {
  const isLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  if (isLight) return LIGHT_TERMINAL_THEME;
  return theme === "dark-black" ? DARK_BLACK_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

type UseXtermArgs = Omit<TerminalInstanceProps, "paneId" | "readOnly" | "liveFeed" | "mirror"> & {
  paneId: string | undefined;
  readOnly: boolean;
  liveFeed: boolean;
  mirror: boolean;
};

/** The xterm.js lifecycle (rule 4: external system sync): session mount, sizing,
 *  appearance, visibility-driven WebGL and dormant ring, and window refit events */
export function useXterm({
  agentId,
  paneId,
  cliType,
  readOnly,
  liveFeed,
  mirror,
  cardFont,
  initialContent,
  onReady,
  onScrollPosition,
  onSelectionChange,
}: UseXtermArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const webglRef = useRef<WebglController | null>(null);
  const refitRef = useRef<() => void>(() => {});
  // The live session in state, so the visibility effects re-run on every rebuild
  const [session, setSession] = useState<TerminalSession | null>(null);

  const setTerminalReady = useTerminalStore((s) => s.setTerminalReady);
  const setTerminalSize = useTerminalStore((s) => s.setTerminalSize);
  const setPaneCwd = useWorkspaceStore((s) => s.setPaneCwd);
  const setPaneLastExit = useWorkspaceStore((s) => s.setPaneLastExit);

  const { data: settings } = useSettings();
  const fontSize = settings?.terminalFontSize ?? 14;
  const fontFamily = settings?.terminalFontFamily ?? "Menlo, Monaco, monospace";
  const terminalTheme = resolveTerminalTheme(settings?.theme ?? "dark");

  // A card that sizes its session behaves like an owner pane for sizing only
  const cardOwns = mirror && cardFont !== undefined;

  // One sizing path: a plain mirror follows the PTY's grid and rescales its
  // font; a pane (or a card that sizes its session) fits and tells the PTY
  const sizeTerminal = useCallback(
    (terminal: Terminal, fit: FitAddon) => {
      if (mirror && !cardOwns) {
        fitMirror(terminal, fontSize);
        return;
      }
      // A mirror never writes the pane's size into the store
      const onSize = mirror ? () => {} : (c: number, r: number) => setTerminalSize(agentId, c, r);
      fitAndSyncSize(terminal, fit, agentId, readOnly, onSize);
    },
    [agentId, setTerminalSize, readOnly, mirror, fontSize, cardOwns],
  );

  const handleResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (fit && terminal) sizeTerminal(terminal, fit);
  }, [sizeTerminal]);

  // Read at call time so a new callback, theme or card toggle never rebuilds the terminal
  const latest = useLatest({
    cliType,
    terminalTheme,
    cardOwns,
    cardFont,
    sizeTerminal,
    onScrollPosition,
    onSelectionChange,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // T155.4 SIGWINCH kick: alt-screen TUIs (opencode/devin/vim) reattach to a black pane after
    // a reload; only the app can repaint an alt screen. Once per session per renderer, and main
    // does the jiggle without telling mirrors
    const kickAltScreen = () => {
      const t = terminalRef.current;
      if (!t || readOnly || mirror || kickedSessions.has(agentId)) return;
      if (t.buffer.active.type !== "alternate") return;
      kickedSessions.add(agentId);
      window.api.terminal.redraw(agentId);
    };

    // A pane mounted at startup waits for its reattach; nothing gave it the keyboard meanwhile
    const takeKeyboard = () => {
      if (readOnly || mirror || !paneId) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const { tabs, activeTabId } = getProjectState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab && getFocusedOrFirstPaneId(tab) === paneId) terminalRef.current?.focus();
    };

    const live = latest.current;
    const next = setupTerminalSession(container, {
      agentId,
      paneId,
      cliType: live.cliType,
      readOnly,
      liveFeed,
      mirror,
      mirrorOwnsSize: () => latest.current.cardOwns,
      onSnapshotApplied: () => {
        if (latest.current.cardOwns) requestAnimationFrame(() => refitRef.current());
        // The alt-screen kick needs the snapshot in the buffer; at startup it waits for the
        // reattach, so a fixed timer ran before it and never kicked
        kickAltScreen();
        takeKeyboard();
      },
      initialContent,
      fontSize,
      fontFamily,
      theme: live.terminalTheme,
      onScrollPosition: live.onScrollPosition
        ? (...args) => latest.current.onScrollPosition?.(...args)
        : undefined,
      onSelectionChange: live.onSelectionChange
        ? (...args) => latest.current.onSelectionChange?.(...args)
        : undefined,
      setPaneCwd,
      setPaneLastExit,
    });

    terminalRef.current = next.terminal;
    fitAddonRef.current = next.fitAddon;
    serializeAddonRef.current = next.serializeAddon;
    setSession(next);

    if (live.cardOwns && live.cardFont) {
      next.terminal.options.fontSize = live.cardFont;
    }
    const refit = () => latest.current.sizeTerminal(next.terminal, next.fitAddon);
    refitRef.current = refit;

    // Double-RAF: first frame settles layout, second fits terminal accurately
    requestAnimationFrame(() => {
      requestAnimationFrame(refit);
    });

    const settleTimer = setTimeout(refit, 150);

    const kickTimer = setTimeout(kickAltScreen, 350);

    if (!mirror) setTerminalReady(agentId);
    onReady?.();

    const resizeObserver = observeContainerSize(container, mirror, refit);
    const mousePress = trackMousePress(container);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(kickTimer);
      resizeObserver.disconnect();
      // WebGL context must be freed before the terminal itself is torn down.
      webglRef.current?.dispose();
      webglRef.current = null;
      // next.dispose() unsubscribes onData/onScroll/OSC handlers + the
      // dormant ring pipe (T115) before xterm's own teardown runs.
      next.dispose();
      // After next.dispose(): the release xterm reports goes nowhere, but its listeners go
      mousePress.release();
      // Disposes every loaded addon too (T143 audit: not a leak)
      next.terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [
    agentId,
    paneId,
    setTerminalReady,
    setPaneCwd,
    setPaneLastExit,
    onReady,
    fontFamily,
    fontSize,
    readOnly,
    liveFeed,
    mirror,
    initialContent,
    latest,
  ]);

  // A theme change repaints in place: it used to be a mount dependency, so a
  // toggle tore down every terminal and replayed each PTY's snapshot
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalTheme;
  }, [terminalTheme]);

  // A card's A-/A+ or its "fit session to card" toggle: new font, then size
  // again (a sizing card re-fits its grid and tells the PTY; a mirror rescales)
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !mirror) return;
    terminal.options.fontSize = cardFont ?? fontSize;
    handleResize();
  }, [cardFont, mirror, fontSize, handleResize]);

  const isVisible = useTerminalVisibility(containerRef, agentId);

  // T115: hidden writes buffer into the dormant ring and replay on un-hide
  useEffect(() => {
    session?.dormantPipe.setVisible(isVisible);
  }, [session, isVisible]);

  useEffect(() => {
    const terminal = session?.terminal;
    // Rebuilt earlier in this commit: the render carrying the new session attaches
    if (!terminal || terminal !== terminalRef.current) return;
    // Mirrors draw on canvas: several open at once would eat into Chromium's
    // ~16 WebGL contexts, and each one rebuilds its atlas on every font fit
    const useCanvas = mirror || (cliType && CANVAS_ONLY_CLI_TYPES.has(cliType));
    if (isVisible && !webglRef.current && !useCanvas) {
      // Same as the menu's Refresh Terminal: the resize makes a TUI redraw its screen
      const controller = createWebglController(terminal, () =>
        window.dispatchEvent(new CustomEvent("exegol:kick-terminal", { detail: { agentId } })),
      );
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
  }, [session, isVisible, mirror, cliType, agentId]);

  // T155 (verify session): manual "Refresh Terminal" from the pane menu —
  // refit + SIGWINCH jiggle + repaint, for TUIs stuck black after reload.
  useEffect(() => {
    const handleKick = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (detail?.agentId !== agentId) return;
      const terminal = terminalRef.current;
      if (!terminal || mirror) return;
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

  // Keyboard navigation (lib/pane-focus) hands this pane the cursor
  useEffect(() => {
    if (mirror || readOnly) return;
    const handleFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId?: string } | undefined;
      if (paneId && detail?.paneId === paneId) terminalRef.current?.focus();
    };
    window.addEventListener("exegol:focus-pane", handleFocus);
    return () => window.removeEventListener("exegol:focus-pane", handleFocus);
  }, [paneId, mirror, readOnly]);

  // Pane menu "Clear Terminal": drop what this view holds (screen + scrollback) and the session's
  // history in main and the sidecar (main then sends Ctrl+L)
  useEffect(() => {
    const handleClear = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (detail?.agentId !== agentId || mirror) return;
      terminalRef.current?.clear();
      if (readOnly) return;
      window.api.terminal.clear(agentId);
    };
    window.addEventListener("exegol:clear-terminal", handleClear);
    return () => window.removeEventListener("exegol:clear-terminal", handleClear);
  }, [agentId, mirror, readOnly]);

  useEffect(() => {
    const handleWindowResize = () => handleResize();
    // Also how a pane takes its size back from a card that was sizing the
    // session (the dashboard hides; the workspace dispatches a refit)
    const handleRefit = () => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      try {
        handleResize();
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

  return { containerRef, terminalRef, fitAddonRef, serializeAddonRef };
}

/** Refits on every box change; `disconnect` also cancels a pending mirror refit */
function observeContainerSize(container: HTMLDivElement, mirror: boolean, refit: () => void) {
  let mirrorFitTimer: ReturnType<typeof setTimeout> | null = null;
  let observedBox = "";
  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? -1;
    if (mirror) {
      // The card sets both dimensions (the grid never sizes its box), so any
      // real change is news. A drag changes it every frame; refit once it
      // stops, since each font step rebuilds the glyph atlas
      const box = `${Math.round(width)}x${Math.round(entry?.contentRect.height ?? -1)}`;
      if (box === observedBox) return;
      observedBox = box;
      if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
      mirrorFitTimer = setTimeout(refit, 120);
      return;
    }
    // ResizeObserver already fires at most once per frame
    refit();
  });
  resizeObserver.observe(container);
  return {
    disconnect: () => {
      if (mirrorFitTimer) clearTimeout(mirrorFitTimer);
      resizeObserver.disconnect();
    },
  };
}
