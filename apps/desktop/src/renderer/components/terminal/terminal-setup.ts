import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  type OscHandlersDisposable,
  registerOscHandlers,
} from "./osc-handlers";
import { getScrollPosition } from "./terminal-buffer";
import { createDormantPipe, type DormantPipe } from "./terminal-dormant-wiring";
import { type CellMetrics, computeFit } from "./terminal-fit";
import { registerTerminalLinkProviders } from "./terminal-links";
import type { TerminalInstanceProps } from "./terminal-types";

export interface TerminalSessionDeps {
  agentId: string;
  paneId?: string;
  cliType?: string;
  readOnly: boolean;
  /** With readOnly: still replay the snapshot + stream live PTY output
   *  (T156 dashboard mini-terminal) — input stays disabled, PTY never resized. */
  liveFeed?: boolean;
  initialContent?: string;
  fontSize: number;
  fontFamily: string;
  theme: ITerminalOptions["theme"];
  onScrollPosition: TerminalInstanceProps["onScrollPosition"];
  onOpenFileLink?: TerminalInstanceProps["onOpenFileLink"];
  onOpenUrlInPane?: TerminalInstanceProps["onOpenUrlInPane"];
  setPaneCwd: (paneId: string, cwd: string) => void;
  setPaneLastExit: (paneId: string, code: number | null) => void;
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
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
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
        setCwd: (cwd) => deps.setPaneCwd(paneId, cwd),
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

  const dormantPipe = createDormantPipe(terminal, true);
  if (deps.initialContent) terminal.write(deps.initialContent);

  const disposables: Array<{ dispose: () => void }> = [];
  let unsubData: (() => void) | null = null;

  // T155: Cmd+click file paths / bare URLs (works in read-only snapshots too)
  disposables.push(
    registerTerminalLinkProviders(terminal, {
      onOpenFile: deps.onOpenFileLink,
      onOpenUrlInPane: deps.onOpenUrlInPane,
    }),
  );

  if (!deps.readOnly) {
    terminal.attachCustomKeyEventHandler((e) => {
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
      if (e.type !== "keydown") return true;
      if (e.key === "Backspace" && (e.ctrlKey || e.metaKey)) {
        window.api.terminal.write(deps.agentId, "\x17");
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
      // Cmd+↓ → jump to newest output
      if (e.metaKey && e.key === "ArrowDown") {
        terminal.scrollToBottom();
        return false;
      }
      return true;
    });

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const filePath = await window.api.terminal.saveClipboardImage();
          if (filePath) window.api.terminal.write(deps.agentId, filePath);
          return;
        }
      }
    };
    container.addEventListener("paste", handlePaste);
    disposables.push({ dispose: () => container.removeEventListener("paste", handlePaste) });

    disposables.push(
      terminal.onData((data) => {
        window.api.terminal.write(deps.agentId, data);
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
    let snapshotResolved = false;
    let liveDisposed = false;
    const liveBuffer: string[] = [];
    unsubData = window.api.terminal.onData(deps.agentId, (data) => {
      if (liveDisposed) return;
      if (!snapshotResolved) {
        liveBuffer.push(data);
      } else {
        dormantPipe.push(data);
      }
    });

    window.api.terminal.getSnapshot(deps.agentId).then((snapshot) => {
      if (liveDisposed) return;
      if (snapshot) terminal.write(snapshot);
      snapshotResolved = true;
      for (const chunk of liveBuffer) dormantPipe.push(chunk);
      liveBuffer.length = 0;
    });

    disposables.push({
      dispose: () => {
        liveDisposed = true;
        liveBuffer.length = 0;
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
 */
/** xterm's defaults; a TUI fit scales these and a shell fit restores them. */
const BASE_LETTER_SPACING = 0;
const BASE_LINE_HEIGHT = 1;

export function fitAndSyncSize(
  terminal: Terminal,
  fitAddon: FitAddon,
  agentId: string,
  readOnly: boolean,
  onSize: (cols: number, rows: number) => void,
): void {
  try {
    // A full-screen TUI paints exactly rows × cols and never scrolls, so the
    // addon's flooring leaves a dead strip along the bottom and right of the
    // pane — which is most of our agent panes, since Gemini, OpenCode, Kiro and
    // Crush are alt-screen apps. Ceil the grid and stretch the cell instead.
    const alternate = terminal.buffer.active.type === "alternate";
    const host = measureHost(terminal);
    const cell = measureCell(terminal);
    const fit = host && cell ? computeFit(host, cell, alternate ? "alternate" : "normal") : null;

    if (fit && alternate) {
      terminal.options.letterSpacing = BASE_LETTER_SPACING * fit.letterSpacing;
      terminal.options.lineHeight = BASE_LINE_HEIGHT * fit.lineHeight;
      terminal.resize(fit.cols, fit.rows);
    } else {
      // Shell panes keep the addon's own arithmetic, and any stretch from a
      // previous TUI is undone — otherwise a shell inherits stretched glyphs.
      terminal.options.letterSpacing = BASE_LETTER_SPACING;
      terminal.options.lineHeight = BASE_LINE_HEIGHT;
      fitAddon.fit();
    }

    const { cols, rows } = terminal;
    onSize(cols, rows);
    if (!readOnly) window.api.terminal.resize(agentId, cols, rows);
  } catch {
    /* container may not be ready */
  }
}

/** xterm exposes the rendered cell size only through this internal service. */
function measureCell(terminal: Terminal): CellMetrics | null {
  const core = (terminal as unknown as { _core?: { _renderService?: { dimensions?: unknown } } })
    ._core?._renderService?.dimensions as
    | { css?: { cell?: { width?: number; height?: number } } }
    | undefined;
  const cell = core?.css?.cell;
  return cell?.width && cell?.height ? { width: cell.width, height: cell.height } : null;
}

function measureHost(terminal: Terminal): { width: number; height: number } | null {
  const el = terminal.element?.parentElement;
  if (!el) return null;
  return { width: el.clientWidth, height: el.clientHeight };
}
