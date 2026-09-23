import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { stripTerminalReports } from "./mirror-input";
import {
  createShellIntegrationState,
  type OscHandlersDisposable,
  registerOscHandlers,
} from "./osc-handlers";
import { getScrollPosition } from "./terminal-buffer";
import { createDormantPipe, type DormantPipe } from "./terminal-dormant-wiring";
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
  /** T194 Dashboard mirror: interactive, but the owning pane answers terminal
   *  queries and owns the PTY size. */
  mirror?: boolean;
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

  if (deps.mirror) {
    // Several mirrors fill the dashboard: a wheel over one must scroll the page,
    // not trap it in that terminal's history. Clicked (focused) = it's yours.
    terminal.attachCustomWheelEventHandler(
      () => !!terminal.element?.contains(document.activeElement),
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

    const applyGrid = (cols: number, rows: number) => {
      terminal.resize(cols, rows);
      fitMirror(terminal, deps.fontSize);
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
      disposables.push({ dispose: window.api.terminal.onResized(deps.agentId, applyGrid) });
    }

    sized
      .then(() => window.api.terminal.getSnapshot(deps.agentId))
      .then((snapshot) => {
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
): void {
  try {
    const host = measureHost(terminal);
    // Unlaid-out box: the addon would fall back to 80x24 and the PTY would
    // redraw (and rewrap) at 80 columns for a frame
    if (!host?.width || !host?.height) return;
    fitAddon.fit();
    const { cols, rows } = terminal;
    onSize(cols, rows);
    if (!readOnly) sendPtyResize(agentId, cols, rows);
  } catch {
    /* container may not be ready */
  }
}

/** Layout settles over a few frames on mount (toolbar, tabs); each size the
 *  PTY sees makes the CLI redraw, so only the last of a burst is sent. */
const pendingResize = new Map<string, ReturnType<typeof setTimeout>>();
function sendPtyResize(agentId: string, cols: number, rows: number): void {
  clearTimeout(pendingResize.get(agentId));
  pendingResize.set(
    agentId,
    setTimeout(() => {
      pendingResize.delete(agentId);
      window.api.terminal.resize(agentId, cols, rows);
    }, 80),
  );
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
