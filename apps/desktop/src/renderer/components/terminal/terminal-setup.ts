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
import { registerTerminalLinkProviders } from "./terminal-links";
import type { TerminalInstanceProps } from "./terminal-types";

export interface TerminalSessionDeps {
  agentId: string;
  paneId?: string;
  readOnly: boolean;
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
      if (e.type !== "keydown") return true;
      if (e.key === "Backspace" && (e.ctrlKey || e.metaKey)) {
        window.api.terminal.write(deps.agentId, "\x17");
        return false;
      }
      // T155 input QoL (klaudio patterns):
      // Shift+Enter → ESC+CR: newline inside the CLI's prompt, not a submit
      if (e.key === "Enter" && e.shiftKey) {
        window.api.terminal.write(deps.agentId, "\x1b\r");
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
export function fitAndSyncSize(
  terminal: Terminal,
  fitAddon: FitAddon,
  agentId: string,
  readOnly: boolean,
  onSize: (cols: number, rows: number) => void,
): void {
  try {
    fitAddon.fit();
    const { cols, rows } = terminal;
    onSize(cols, rows);
    if (!readOnly) window.api.terminal.resize(agentId, cols, rows);
  } catch {
    /* container may not be ready */
  }
}
