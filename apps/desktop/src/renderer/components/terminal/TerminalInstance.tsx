import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useSettings } from "../../hooks/use-trpc";
import { useTerminalStore } from "../../stores/terminals";

export interface TerminalInstanceHandle {
  /** Serialize the terminal buffer state (ANSI escape sequences + cursor/attribute state). */
  serialize: () => string | null;
}

interface TerminalInstanceProps {
  agentId: string;
  readOnly?: boolean;
  initialContent?: string;
  onReady?: () => void;
}

const DARK_TERMINAL_THEME = {
  background: "#0a0a0b",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  cursorAccent: "#0a0a0b",
  selectionBackground: "#6366f133",
  selectionForeground: "#e4e4e7",
  black: "#0a0a0b",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#fafafa",
};

const LIGHT_TERMINAL_THEME = {
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#18181b",
  cursorAccent: "#ffffff",
  selectionBackground: "#6366f133",
  selectionForeground: "#18181b",
  black: "#18181b",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f4f4f5",
  brightBlack: "#71717a",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
};

export const TerminalInstance = forwardRef(function TerminalInstance(
  { agentId, readOnly = false, initialContent, onReady }: TerminalInstanceProps,
  ref: ForwardedRef<TerminalInstanceHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);

  // Expose serialize method to parent via ref
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
  }));

  const setTerminalReady = useTerminalStore((s) => s.setTerminalReady);
  const setTerminalSize = useTerminalStore((s) => s.setTerminalSize);
  const { data: settings } = useSettings();

  const fontSize = settings?.terminalFontSize ?? 14;
  const fontFamily = settings?.terminalFontFamily ?? "Menlo, Monaco, monospace";
  const theme = settings?.theme ?? "dark";
  const isLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);

  const handleResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) return;

    try {
      fitAddon.fit();
      const { cols, rows } = terminal;
      setTerminalSize(agentId, cols, rows);
      if (!readOnly) {
        window.api.terminal.resize(agentId, cols, rows);
      }
    } catch {
      // Fit can fail if container isn't visible
    }
  }, [agentId, setTerminalSize, readOnly]);

  // Rule 4: external system sync — xterm.js setup/teardown, PTY wiring, resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: isLight ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME,
      fontSize,
      fontFamily,
      cursorBlink: !readOnly,
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
      convertEol: true,
      disableStdin: readOnly,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(webLinksAddon);

    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    serializeAddonRef.current = serializeAddon;

    terminal.open(container);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not supported
    }

    // Write initial content for read-only (scrollback replay)
    if (initialContent) {
      terminal.write(initialContent);
    }

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        const { cols, rows } = terminal;
        setTerminalSize(agentId, cols, rows);
        if (!readOnly) {
          window.api.terminal.resize(agentId, cols, rows);
        }
      } catch {
        // Ignore initial fit failures
      }
    });

    const disposables: Array<{ dispose: () => void }> = [];
    let unsubData: (() => void) | null = null;

    if (!readOnly) {
      // Connect terminal input -> main process
      disposables.push(
        terminal.onData((data) => {
          window.api.terminal.write(agentId, data);
        }),
      );

      // Connect main process output -> terminal
      unsubData = window.api.terminal.onData(agentId, (data) => {
        terminal.write(data);
      });
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    setTerminalReady(agentId);
    onReady?.();

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const { cols, rows } = terminal;
          setTerminalSize(agentId, cols, rows);
          if (!readOnly) {
            window.api.terminal.resize(agentId, cols, rows);
          }
        } catch {
          // Ignore resize errors
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      for (const d of disposables) d.dispose();
      unsubData?.();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [
    agentId,
    setTerminalReady,
    setTerminalSize,
    onReady,
    fontFamily,
    fontSize,
    readOnly,
    initialContent,
    isLight,
  ]);

  // Rule 4: external system sync — update xterm.js options when settings change
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      terminalRef.current.options.fontFamily = fontFamily;
      fitAddonRef.current?.fit();
    }
  }, [fontSize, fontFamily]);

  // Rule 4: external system sync — window resize listener for terminal fit
  useEffect(() => {
    const handleWindowResize = () => handleResize();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [handleResize]);

  return <div ref={containerRef} className="terminal-container h-full w-full bg-bg-primary" />;
});
