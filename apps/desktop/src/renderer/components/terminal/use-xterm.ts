import { gridLabel } from "@exegol/shared";
import type { FitAddon } from "@xterm/addon-fit";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useSettings } from "../../hooks/use-trpc";
import { kickTerminal } from "../../lib/dispatch-refit";
import { claimPaneFocus } from "../../lib/pane-focus";
import { noteSwitchMount } from "../../lib/project-switch-log";
import { useTerminalStore } from "../../stores/terminals";
import {
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import { layoutHasPane } from "../../stores/workspace/helpers";
import { refitWhenFontLoads } from "./font-ready";
import { mountRepaint } from "./live-seq";
import { createSettleTracker, SETTLE_WINDOW_MS } from "./mount-settle";
import { trackMousePress } from "./mouse-release";
import {
  cancelPtyResize,
  fitAndSyncSize,
  fitMirror,
  type SnapshotApplied,
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
import { createWebglController, listenGpuRepaint, type WebglController } from "./terminal-webgl";
import { useTerminalVisibility } from "./use-terminal-visibility";
import { trackTerminalView, webglBudget } from "./webgl-budget";

/** Sessions this renderer has mounted a live view of (pane or mirror): the first mount kicks an alt screen */
const mountedSessions = new Set<string>();
/** The grid each session's pane last fitted at, for the next mount to start from */
const lastGrids = new Map<string, { cols: number; rows: number }>();

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
  onTuiCopy,
}: UseXtermArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const webglRef = useRef<WebglController | null>(null);
  const refitRef = useRef<() => void>(() => {});
  // A hide dropped a size this view was settling: refit once it is back on screen
  const resizeDroppedRef = useRef(false);
  // The live session in state, so the visibility effects re-run on every rebuild
  const [session, setSession] = useState<TerminalSession | null>(null);
  // Inactive tabs and the Agents area under the Dashboard are `invisible`, which xterm and an
  // IntersectionObserver still count as on screen: the container then takes display: none
  const [shown, setShown] = useState(true);

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
  // font; a pane (or a card that sizes its session) fits and tells the PTY.
  // False while the box is unmeasured (hidden): nothing was fitted
  const sizeTerminal = useCallback(
    (terminal: Terminal, fit: FitAddon): boolean => {
      if (mirror && !cardOwns) {
        fitMirror(terminal, fontSize);
        return true;
      }
      // A mirror never writes the pane's size into the store
      const onSize = mirror
        ? () => {}
        : (cols: number, rows: number) => {
            setTerminalSize(agentId, cols, rows);
            if (!readOnly) lastGrids.set(agentId, { cols, rows });
          };
      return fitAndSyncSize(terminal, fit, agentId, readOnly, onSize);
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
    onTuiCopy,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Repaint decided once the snapshot is parsed AND the box measured (mountRepaint)
    let applied: SnapshotApplied | null = null;
    let fitted = false;
    let settled = false;
    let settle: ReturnType<typeof createSettleTracker> | null = null;
    let reportTimer: ReturnType<typeof setTimeout> | undefined;
    const reportSettle = () => {
      clearTimeout(reportTimer);
      const report = settle?.report();
      settle = null;
      if (report) window.api.terminal.mountLog(agentId, report);
    };
    const settleMount = () => {
      const t = terminalRef.current;
      if (settled || !applied || !fitted || !t) return;
      settled = true;
      const repaint = mountRepaint({
        live: !readOnly,
        alternate: t.buffer.active.type === "alternate",
        firstMount: !mountedSessions.has(agentId),
        snapshotBytes: applied.bytes,
        snap: applied.grid,
        fit: { cols: t.cols, rows: t.rows },
      });
      if (!readOnly) mountedSessions.add(agentId);
      if (repaint === "kick") window.api.terminal.redraw(agentId);
      window.api.terminal.mountLog(agentId, {
        kind: "mount",
        snapshotBytes: applied.bytes,
        snapshotMs: applied.fetchMs,
        paintMs: applied.paintMs,
        snapGrid: applied.grid ? gridLabel(applied.grid.cols, applied.grid.rows) : null,
        fitGrid: gridLabel(t.cols, t.rows),
        replayed: applied.replayed,
        dropped: applied.dropped,
        kick: repaint === "kick",
      });
      settle = createSettleTracker(gridLabel(t.cols, t.rows), () => performance.now());
      reportTimer = setTimeout(reportSettle, SETTLE_WINDOW_MS);
    };

    // A pane mounted at startup waits for its reattach; nothing gave it the keyboard meanwhile
    // Counted for the project switch log ([ProjectSwitch]), hidden tabs included
    const switchLanded =
      mirror || !paneId || (readOnly && !liveFeed) ? null : noteSwitchMount(inActiveTab(paneId));

    const takeKeyboard = () => {
      if (readOnly || mirror || !paneId) return;
      // Opened for the user: the menu or button that started it may hold the focus by now
      if (claimPaneFocus(paneId)) {
        terminalRef.current?.focus();
        return;
      }
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
      onSnapshotApplied: (info) => {
        applied = info;
        const t = terminalRef.current;
        switchLanded?.({
          bytes: info.bytes,
          reflow: !!info.grid && !!t && (info.grid.cols !== t.cols || info.grid.rows !== t.rows),
        });
        if (!mirror || latest.current.cardOwns) refitRef.current();
        settleMount();
        takeKeyboard();
      },
      refit: () => refitRef.current(),
      initialGrid: readOnly || mirror ? undefined : lastGrids.get(agentId),
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
      onTuiCopy: live.onTuiCopy ? (text) => latest.current.onTuiCopy?.(text) : undefined,
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
    // Parked and concealed until the visibility effect shows it: never a DOM frame first
    webglRef.current = wantsWebgl(mirror, live.cliType)
      ? createWebglController(next.terminal, {
          // Same as the menu's Refresh Terminal: the resize makes a TUI redraw its screen
          onLost: () => kickTerminal(agentId),
          onRendererChanged: () => refitRef.current(),
          onChurn: (trip) =>
            window.api.terminal.mountLog(agentId, { kind: "atlas-churn", ...trip }),
        })
      : null;
    const refit = () => {
      // WebGL cells are whole device pixels (8.0 vs the DOM's 8.43 px): a fit before the addon
      // attaches lands ~5% fewer columns and refits a frame later (`settled 130x57 -> 137x57`)
      if (webglRef.current?.pending()) return;
      if (!latest.current.sizeTerminal(next.terminal, next.fitAddon)) return;
      settle?.fit(gridLabel(next.terminal.cols, next.terminal.rows));
      fitted = true;
      settleMount();
    };
    refitRef.current = refit;

    // Double-RAF: first frame settles layout, second fits terminal accurately
    requestAnimationFrame(() => {
      requestAnimationFrame(refit);
    });

    const settleTimer = setTimeout(refit, 150);
    const cancelFontRefit = refitWhenFontLoads(next.terminal, refit);

    if (!mirror) setTerminalReady(agentId);
    onReady?.();

    const resizeObserver = observeContainerSize(container, mirror, refit);
    const untrackView = trackTerminalView();
    setShown(isShown(container));
    const mousePress = trackMousePress(container);

    return () => {
      clearTimeout(settleTimer);
      cancelFontRefit();
      resizeObserver.disconnect();
      cancelPtyResize(agentId, next.terminal);
      reportSettle();
      switchLanded?.(null);
      if (settled) window.api.terminal.mountLog(agentId, { kind: "unmount" });
      untrackView();
      // WebGL context must be freed before the terminal itself is torn down.
      webglRef.current?.dispose();
      webglRef.current = null;
      // next.dispose() unsubscribes onData/onScroll/OSC handlers + the
      // dormant ring pipe (T115) before xterm's own teardown runs.
      next.dispose();
      // After next.dispose(): the release xterm reports goes nowhere, but its listeners go
      try {
        mousePress.release();
      } catch {
        // xterm's own mouseup handler: a throw must not skip terminal.dispose()
      }
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

  // Shown again after display: none: the ResizeObserver can fire before the cells are measured
  const wasShownRef = useRef(shown);
  useEffect(() => {
    const back = shown && !wasShownRef.current;
    wasShownRef.current = shown;
    if (!back) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => refitRef.current());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [shown]);

  // T115: hidden writes buffer into the dormant ring and replay on un-hide
  useEffect(() => {
    session?.dormantPipe.setVisible(isVisible);
  }, [session, isVisible]);

  useEffect(() => {
    const terminal = session?.terminal;
    // Rebuilt earlier in this commit: the render carrying the new session attaches
    if (!terminal || terminal !== terminalRef.current) return;
    const onScreen = isVisible && shown;
    // A size measured just before hiding is not the one it comes back to
    if (!onScreen && cancelPtyResize(agentId, terminal)) resizeDroppedRef.current = true;
    if (onScreen && resizeDroppedRef.current) {
      resizeDroppedRef.current = false;
      refitRef.current();
    }
    // Parking is at once: the context stays, it only becomes the first a shown terminal may take
    if (onScreen) webglRef.current?.unpark();
    else webglRef.current?.park();
  }, [session, isVisible, shown, agentId]);

  // A shell promoted to a canvas-only CLI (or a cliType that loaded after mount) drops WebGL
  useEffect(() => {
    if (!session || wantsWebgl(mirror, cliType) || !webglRef.current) return;
    webglRef.current.dispose();
    webglRef.current = null;
    refitRef.current();
  }, [session, mirror, cliType]);

  // Refit, redraw this view and have the CLI repaint (all of it, or only an alt screen). Pane and
  // mirror of one session both ask; main makes one repaint of the burst
  const repaintView = useCallback(
    (onlyAlt: boolean) => {
      const terminal = terminalRef.current;
      if (!terminal) return false;
      handleResize();
      terminal.refresh(0, terminal.rows - 1);
      if (!readOnly && (!onlyAlt || terminal.buffer.active.type === "alternate")) {
        window.api.terminal.redraw(agentId);
      }
      return true;
    },
    [agentId, readOnly, handleResize],
  );

  // Refresh Terminal (pane menu, Watching card)
  useEffect(() => {
    const handleKick = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (detail?.agentId !== agentId) return;
      try {
        repaintView(false);
      } catch {
        /* not ready */
      }
    };
    window.addEventListener("exegol:kick-terminal", handleKick);
    return () => window.removeEventListener("exegol:kick-terminal", handleKick);
  }, [agentId, repaintView]);

  // GPU process crashed (lib/gpu-repaint): a context xterm "restored" while hidden can stay
  // blank, so every view drops its addon (freeing the shared glyph atlas, blank since the
  // crash), then takes a new one, refits, repaints and kicks an alt-screen TUI
  useEffect(
    () =>
      listenGpuRepaint(
        window,
        () => webglRef.current,
        () => repaintView(true),
      ),
    [repaintView],
  );

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

  useEffect(() => {
    if (!mirror) return;
    const handleFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (detail?.agentId === agentId) terminalRef.current?.focus();
    };
    window.addEventListener("exegol:focus-mirror", handleFocus);
    return () => window.removeEventListener("exegol:focus-mirror", handleFocus);
  }, [agentId, mirror]);

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
      const container = containerRef.current;
      if (container) setShown(isShown(container));
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

  return { containerRef, terminalRef, fitAddonRef, serializeAddonRef, shown };
}

function inActiveTab(paneId: string): boolean {
  const { tabs, activeTabId } = getProjectState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return !!tab && layoutHasPane(tab.layout, paneId);
}

/** Mirrors draw on canvas: several open at once would eat into Chromium's ~16 WebGL contexts,
 *  and each one rebuilds its atlas on every font fit. Nor canvas-only CLIs, nor anything once
 *  the GPU fell back for good */
function wantsWebgl(mirror: boolean, cliType: string | undefined): boolean {
  return !mirror && !(cliType && CANVAS_ONLY_CLI_TYPES.has(cliType)) && !webglBudget.isDomOnly();
}

/** On the container's parent: the container itself is display: none while hidden, and a hidden
 *  tab or the Agents area under the Dashboard is `visibility: hidden` */
function isShown(container: HTMLElement): boolean {
  const el = container.parentElement ?? container;
  return el.checkVisibility?.({ visibilityProperty: true }) ?? true;
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
