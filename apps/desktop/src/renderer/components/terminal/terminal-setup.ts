import { CLIPBOARD_IMAGE, type LiveSnapshot } from "@exegol/shared";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { isDictationChord } from "../../lib/dictation/shortcut";
import { appChord, chordKey, IS_MAC } from "../../lib/keymap";
import { isPaneSwitcherMounted } from "../../lib/pane-switcher-control";
import { persistShellCwd } from "../../lib/shell-cwd";
import { useAgentStore } from "../../stores/agents";
import { keepSelection } from "./keep-selection";
import { chunksAfterSnapshot, createLiveBuffer, resizeToSnapshot } from "./live-seq";
import { stripTerminalReports } from "./mirror-input";
import {
  createShellIntegrationState,
  type OscHandlersDisposable,
  registerOscHandlers,
} from "./osc-handlers";
import { createResizeStabilizer } from "./resize-stabilizer";
import { getScrollPosition } from "./terminal-buffer";
import { createDormantPipe, type DormantPipe } from "./terminal-dormant-wiring";
import { registerTerminalLinkProviders } from "./terminal-link-providers";
import type { TerminalInstanceProps } from "./terminal-types";
import { tuneWheelSensitivity } from "./tui-wheel";

const CTRL_V = "\x16";

interface TerminalSessionDeps {
  agentId: string;
  paneId?: string;
  cliType?: string;
  readOnly: boolean;
  /** With readOnly: still replay the snapshot + stream live PTY output
   *  (T156 dashboard mini-terminal) — input stays disabled, PTY never resized. */
  liveFeed?: boolean;
  /** T194 Dashboard mirror: interactive, but the owning pane answers terminal
   *  queries and owns the PTY size. */
  mirror?: boolean;
  /** Mirror whose card sizes the session (T194 "fit session to card"): read live */
  mirrorOwnsSize?: () => boolean;
  /** A frame after the snapshot is parsed */
  onSnapshotApplied?: (info: SnapshotApplied) => void;
  /** Fit the view again after a snapshot was written at its own grid */
  refit?: () => void;
  initialContent?: string;
  fontSize: number;
  fontFamily: string;
  theme: ITerminalOptions["theme"];
  onScrollPosition: TerminalInstanceProps["onScrollPosition"];
  onSelectionChange?: TerminalInstanceProps["onSelectionChange"];
  setPaneCwd: (paneId: string, cwd: string) => void;
  setPaneLastExit: (paneId: string, code: number | null) => void;
}

export interface SnapshotApplied {
  bytes: number;
  fetchMs: number;
  /** From mount */
  paintMs: number;
  grid: { cols: number; rows: number } | null;
  replayed: number;
  dropped: number;
}

export interface TerminalSession {
  terminal: Terminal;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  dormantPipe: DormantPipe;
  oscHandlers: OscHandlersDisposable | null;
  /** Tear down all listeners + addons but not the terminal itself. */
  dispose: () => void;
}

/**
 * Build a Terminal, attach addons, and wire input/output (PTY <-> xterm),
 * shell-integration OSC handlers (T112), and the dormant ring pipe (T115).
 */
export function setupTerminalSession(
  container: HTMLElement,
  deps: TerminalSessionDeps,
): TerminalSession {
  const terminal = new Terminal({
    theme: deps.theme,
    fontSize: deps.fontSize,
    fontFamily: deps.fontFamily,
    cursorBlink: !deps.readOnly,
    cursorStyle: "bar",
    scrollback: 5_000,
    allowProposedApi: true,
    convertEol: true,
    disableStdin: deps.readOnly,
    // A TUI tracking the mouse (Claude) turns xterm's selection off: Option+drag selects anyway,
    // as Shift+drag does off macOS, so Copy and Send to still have text
    macOptionClickForcesSelection: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);

  terminal.open(container);

  let oscHandlers: OscHandlersDisposable | null = null;
  if (!deps.readOnly && deps.paneId) {
    const state = createShellIntegrationState();
    const paneId = deps.paneId;
    oscHandlers = registerOscHandlers(
      terminal,
      {
        setCwd: (cwd) => {
          deps.setPaneCwd(paneId, cwd);
          persistShellCwd(deps.agentId, cwd);
        },
        setLastExit: (code) => deps.setPaneLastExit(paneId, code),
        // Read at answer time, not captured: a theme switch mid-session must
        // change what the next query gets back.
        getColors: () => ({
          foreground: terminal.options.theme?.foreground ?? "#e4e4e7",
          background: terminal.options.theme?.background ?? "#0a0a0b",
          cursor: terminal.options.theme?.cursor ?? "#e4e4e7",
        }),
      },
      state,
    );
  }

  if (deps.mirror) {
    // Several mirrors fill the dashboard: a wheel over one must scroll the page,
    // not trap it in that terminal's history. Clicked (focused) = it's yours.
    terminal.attachCustomWheelEventHandler((e) => {
      tuneWheelSensitivity(terminal, e);
      return !!terminal.element?.contains(document.activeElement);
    });
  } else if (deps.cliType && deps.cliType !== "shell") {
    // An agent TUI in the alternate screen that did not ask for mouse events gets the wheel as
    // ↑/↓ from xterm, and ↑ in an empty prompt recalls the last message: drop only that case.
    // This handler runs before mouse reporting, so a TUI that tracks the mouse (and scrolls
    // with it) must pass. Shells keep it all: vim and less scroll with the arrows
    terminal.attachCustomWheelEventHandler((e) => {
      tuneWheelSensitivity(terminal, e);
      return (
        terminal.buffer.active.type !== "alternate" || terminal.modes.mouseTrackingMode !== "none"
      );
    });
  } else {
    // Shells: vim or less with the mouse on get the same trackpad fix
    terminal.attachCustomWheelEventHandler((e) => {
      tuneWheelSensitivity(terminal, e);
      return true;
    });
  }

  const fetchSnapshot = async (): Promise<LiveSnapshot | null> => {
    const snapshot = await window.api.terminal.getSnapshot(deps.agentId).catch(() => null);
    // Main's grid: another window or a card may have moved the PTY since this renderer sent one
    if (snapshot) ptyResizes.noteSize(deps.agentId, snapshot.cols, snapshot.rows);
    return snapshot;
  };
  const live = !deps.readOnly || !!deps.liveFeed;
  const dormantPipe = createDormantPipe(
    terminal,
    true,
    live ? fetchSnapshot : undefined,
    deps.refit,
  );
  if (deps.initialContent) terminal.write(deps.initialContent);

  const disposables: Array<{ dispose: () => void }> = [];
  let unsubData: (() => void) | null = null;

  // URLs and file paths open in Exegol (read-only snapshots and mirrors too)
  disposables.push(registerTerminalLinkProviders(terminal, deps.agentId));

  if (!deps.readOnly) {
    terminal.attachCustomKeyEventHandler((e) => {
      // The dictation shortcut (both phases: its key-up ends hold-to-talk) belongs to the app
      if (isDictationChord(e)) return false;
      // T155 input QoL: Shift+Enter → newline, not submit. Two traps found
      // live (2026-08-11): (1) Enter fires a legacy keypress that xterm turns
      // into a stray CR unless EVERY phase is swallowed; (2) a pasted lone
      // "\n" is normalized to Enter by TUIs. Payload per CLI: claude uses its
      // documented backslash+CR line continuation; bubbletea TUIs (opencode,
      // crush) bind Ctrl+J (LF) as insert-newline.
      if (e.key === "Enter" && e.shiftKey) {
        if (e.type === "keydown") {
          const seq = deps.cliType === "claude-code" ? "\\\r" : "\n";
          window.api.terminal.write(deps.agentId, seq);
        }
        return false;
      }
      // Ctrl+Tab is the pane switcher where one is mounted: xterm would send Tab, and
      // Ctrl+Shift+Tab Shift+Tab, which flips Claude's permission mode
      if (e.ctrlKey && e.key === "Tab") return !isPaneSwitcherMounted();
      if (e.type !== "keydown") return true;
      if (e.key === "Backspace" && (e.ctrlKey || e.metaKey || e.altKey)) {
        window.api.terminal.write(deps.agentId, "\x17");
        return false;
      }
      // Option+←/→ → word back/forward (ESC b / ESC f). xterm sent CSI 1;3D, which zsh has no
      // binding for, so a plain shell printed "D"
      if (e.altKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        window.api.terminal.write(deps.agentId, e.key === "ArrowLeft" ? "\x1bb" : "\x1bf");
        return false;
      }
      // Cmd+←/→ → Ctrl+A/Ctrl+E (line home/end, the macOS muscle memory)
      if (e.metaKey && e.key === "ArrowLeft") {
        window.api.terminal.write(deps.agentId, "\x01");
        return false;
      }
      if (e.metaKey && e.key === "ArrowRight") {
        window.api.terminal.write(deps.agentId, "\x05");
        return false;
      }
      const chord = appChord(e);
      // Cmd+↓ (Ctrl+Shift+↓ off macOS) → jump to newest output
      if (chord && chordKey(e) === "ArrowDown") {
        terminal.scrollToBottom();
        return false;
      }
      if (chord && !IS_MAC) {
        // Linux/Windows have no Edit menu: Ctrl+Shift+C copies, as in other terminals
        // (Ctrl+Shift+V is Chromium's own paste)
        if (chordKey(e) === "c" && terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          return false;
        }
        // Every other Ctrl+Shift(+Alt) chord is an app shortcut: xterm would send Alt ones as ESC
        if (chordKey(e) !== "v") return false;
      }
      return true;
    });

    // Capture phase: xterm's own paste handler on its textarea stops the event, so a bubbling
    // listener here never saw Cmd+V with an image. A CLI that reads the clipboard itself gets its
    // own paste key or command (CLIPBOARD_IMAGE: Claude attaches "[Image #N]"); the others get the
    // image saved to a file and its path typed in. The cliType is read now: a terminal can have
    // become an agent since setup
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || ![...items].some((item) => item.type.startsWith("image/"))) return;
      e.preventDefault();
      e.stopPropagation();
      const cliType = useAgentStore.getState().agents[deps.agentId]?.cliType ?? deps.cliType;
      const way = cliType ? CLIPBOARD_IMAGE[cliType] : undefined;
      if (way) {
        window.api.terminal.write(deps.agentId, way === "ctrl-v" ? CTRL_V : "/paste");
        return;
      }
      const filePath = await window.api.terminal.saveClipboardImage();
      if (filePath) window.api.terminal.write(deps.agentId, filePath);
    };
    container.addEventListener("paste", handlePaste, true);
    disposables.push({
      dispose: () => container.removeEventListener("paste", handlePaste, true),
    });

    disposables.push(
      terminal.onData((data) => {
        const out = deps.mirror ? stripTerminalReports(data) : data;
        if (out) window.api.terminal.write(deps.agentId, out);
      }),
    );

    // Snapshot must land BEFORE any live bytes so the history isn't replayed
    // after newer output. Buffer live data until getSnapshot resolves, then
    // write the snapshot directly to xterm (bypassing the dormant ring so a
    // large snapshot isn't truncated to its 256 KB cap when the pane mounts
    // hidden), and finally drain the live buffer in arrival order.
  }

  // Live feed runs for interactive terminals AND liveFeed viewers (T156):
  // snapshot replay first, buffering any output that races it.
  if (!deps.readOnly || deps.liveFeed) {
    const mountedAt = performance.now();
    let snapshotResolved = false;
    let liveDisposed = false;
    const liveBuffer = createLiveBuffer();
    unsubData = window.api.terminal.onData(deps.agentId, (data, seq) => {
      if (liveDisposed) return;
      if (!snapshotResolved) {
        liveBuffer.push({ data, seq });
      } else {
        dormantPipe.push(data, seq);
      }
    });

    const applyGrid = (cols: number, rows: number) => {
      terminal.resize(cols, rows);
      if (!deps.mirrorOwnsSize?.()) fitMirror(terminal, deps.fontSize);
    };
    // A mirror must be at the PTY's grid BEFORE the snapshot lands, or history
    // written at 80 columns wraps differently from the pane that owns it
    const sized = deps.mirror
      ? window.api.terminal
          .getSize(deps.agentId)
          .then((size) => {
            if (size && !liveDisposed) applyGrid(size.cols, size.rows);
          })
          .catch(() => {})
      : Promise.resolve();

    // ...and follows the owner's resizes after that
    if (deps.mirror) {
      // A card that sizes the session hears its own resizes echoed back: ignore
      disposables.push({
        dispose: window.api.terminal.onResized(deps.agentId, (cols, rows) => {
          if (!deps.mirrorOwnsSize?.()) applyGrid(cols, rows);
        }),
      });
    }

    let askedAt = mountedAt;
    const askSnapshot = () => {
      askedAt = performance.now();
      return fetchSnapshot();
    };
    const applySnapshot = (snapshot: LiveSnapshot | null): void => {
      if (liveDisposed) return;
      const buffered = liveBuffer.take();
      // Too much output raced it: a newer snapshot holds all of it
      if (buffered === null) {
        void askSnapshot().then(applySnapshot);
        return;
      }
      const fetchMs = performance.now() - askedAt;
      const data = snapshot?.data ?? "";
      if (!deps.mirror) resizeToSnapshot(terminal, snapshot);
      // Chunks that raced the snapshot and are already in it would be written twice
      const { replay, dropped } = chunksAfterSnapshot(buffered, snapshot?.seq);
      snapshotResolved = true;
      terminal.write(data, () => {
        requestAnimationFrame(() => {
          if (liveDisposed) return;
          deps.onSnapshotApplied?.({
            bytes: data.length,
            fetchMs,
            paintMs: performance.now() - mountedAt,
            grid: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
            replayed: replay.length,
            dropped,
          });
        });
      });
      for (const chunk of replay) dormantPipe.push(chunk.data, chunk.seq);
    };
    void sized.then(askSnapshot).then(applySnapshot);

    disposables.push({
      dispose: () => {
        liveDisposed = true;
        liveBuffer.take();
      },
    });
  }

  if (deps.onScrollPosition) {
    const cb = deps.onScrollPosition;
    const checkScroll = (wrote: boolean) => {
      const { atTop, atBottom } = getScrollPosition(terminal);
      cb(atTop, atBottom, wrote);
    };
    disposables.push(terminal.onScroll(() => checkScroll(false)));
    disposables.push(terminal.onWriteParsed(() => checkScroll(true)));
  }

  if (deps.onSelectionChange) {
    const cb = deps.onSelectionChange;
    disposables.push(terminal.onSelectionChange(() => cb(terminal.hasSelection())));
    if (terminal.element) disposables.push(keepSelection(terminal, terminal.element));
  }

  function dispose(): void {
    for (const d of disposables) d.dispose();
    unsubData?.();
    oscHandlers?.dispose();
    dormantPipe.dispose();
  }

  return { terminal, fitAddon, serializeAddon, dormantPipe, oscHandlers, dispose };
}

/**
 * Fit the terminal and broadcast the new size to PTY + store. Wrapped so the
 * many callers in TerminalInstance don't each have to repeat the try/catch.
 *
 * Always the addon's floored grid. An alt-screen variant used to CEIL the rows
 * and meant to squeeze the line height to compensate, but the squeeze was a
 * no-op: every fit left the grid one row taller than its box, the box grew to
 * hold it, and the next fit added another row, so the PTY kept gaining rows
 * nobody could see (Claude's input box ended up below the edge) (T194 logs).
 */
export function fitAndSyncSize(
  terminal: Terminal,
  fitAddon: FitAddon,
  agentId: string,
  readOnly: boolean,
  onSize: (cols: number, rows: number) => void,
): boolean {
  try {
    const host = measureHost(terminal);
    // Unlaid-out or hidden (display: none) box, or cells not measured yet: the addon would fall
    // back to 80x24 and the PTY would redraw (and rewrap) at 80 columns for a frame
    if (!host?.width || !host?.height) return false;
    const dims = fitAddon.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false;
    fitAddon.fit();
    const { cols, rows } = terminal;
    onSize(cols, rows);
    if (!readOnly) ptyResizes.request(agentId, terminal, cols, rows);
    return true;
  } catch {
    /* container may not be ready */
    return false;
  }
}

const ptyResizes = createResizeStabilizer((agentId, cols, rows) =>
  window.api.terminal.resize(agentId, cols, rows),
);

/** A view that unmounts or hides drops the size it was settling: a transient layout size
 *  reached the PTY after the user had already left. True when there was one */
export function cancelPtyResize(agentId: string, terminal: Terminal): boolean {
  return ptyResizes.cancel(agentId, terminal);
}

/** Latest fit per terminal: a newer call makes older rAF retry chains exit, so
 *  two chains measuring a width that lags a frame can't shrink it twice. */
const mirrorFitGeneration = new WeakMap<Terminal, number>();

/**
 * T194: a mirror renders at the PTY's real grid, so output wraps exactly as in
 * the owning pane, and shrinks its font to fit the card instead of resizing.
 */
export function fitMirror(terminal: Terminal, baseFontSize: number): void {
  const generation = (mirrorFitGeneration.get(terminal) ?? 0) + 1;
  mirrorFitGeneration.set(terminal, generation);
  const step = (attempt: number) => {
    if (mirrorFitGeneration.get(terminal) !== generation) return;
    try {
      const host = measureHost(terminal);
      // The painted grid, not xterm's internal cell metrics: those may not exist
      // yet, and a mirror that never measures keeps its full font and overflows
      const rect = terminal.element
        ?.querySelector<HTMLElement>(".xterm-screen")
        ?.getBoundingClientRect();
      if (host?.width && host.height && rect?.width && rect.height) {
        const current = terminal.options.fontSize ?? baseFontSize;
        const drawn = { width: rect.width, height: rect.height };
        const next = nextMirrorFont(current, drawn, host, baseFontSize);
        if (next === null) return;
        terminal.options.fontSize = next;
      }
    } catch {
      /* container may not be ready */
    }
    // Unmeasured, or glyph metrics settle a frame after a font change
    if (attempt < 10) requestAnimationFrame(() => step(attempt + 1));
  };
  step(0);
}

/**
 * Next font for a mirror, or null when it should stay put. Glyph sizes round
 * to device pixels, so the painted grid moves in steps: jumping by ratio
 * alone overshot the size that fits and flip-flopped forever, and every font
 * change rebuilds xterm's glyph atlas (~50ms a frame, the renderer never went
 * idle). Overflow always shrinks strictly, fitting is final, and only a card
 * with lots of room left grows, so the sequence always ends.
 */
export function nextMirrorFont(
  current: number,
  drawn: { width: number; height: number },
  host: { width: number; height: number },
  base: number,
): number | null {
  // The tighter of the two dimensions decides: a full-height card is usually
  // width-bound, a wide one height-bound
  const ratio = Math.min(host.width / drawn.width, host.height / drawn.height);
  const byRatio = Math.floor(current * ratio * 4) / 4;
  if (drawn.width > host.width + 1 || drawn.height > host.height + 1) {
    const next = Math.max(6, Math.min(current - 0.25, byRatio));
    return next < current ? next : null;
  }
  const loose = drawn.width < host.width * 0.75 && drawn.height < host.height * 0.75;
  if (loose && current < base) {
    const next = Math.min(base, byRatio);
    return next > current ? next : null;
  }
  return null;
}

function measureHost(terminal: Terminal): { width: number; height: number } | null {
  const el = terminal.element?.parentElement;
  if (!el) return null;
  return { width: el.clientWidth, height: el.clientHeight };
}
