import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { useSettings } from "../../hooks/use-trpc";
import { useTerminalStore } from "../../stores/terminals";

interface TerminalPanelProps {
  agentId: string;
  onReady?: () => void;
}

export function TerminalPanel({ agentId, onReady }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setTerminalReady = useTerminalStore((s) => s.setTerminalReady);
  const setTerminalSize = useTerminalStore((s) => s.setTerminalSize);
  const { data: settings } = useSettings();

  const fontSize = settings?.terminalFontSize ?? 14;
  const fontFamily = settings?.terminalFontFamily ?? "JetBrains Mono, Menlo, Monaco, monospace";

  const handleResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) return;

    try {
      fitAddon.fit();
      const { cols, rows } = terminal;
      setTerminalSize(agentId, cols, rows);
      window.api.terminal.resize(agentId, cols, rows);
    } catch {
      // Fit can fail if container isn't visible
    }
  }, [agentId, setTerminalSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: {
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
      },
      fontSize,
      fontFamily,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);

    // Try loading WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not supported, fallback to canvas renderer
    }

    // Fit after a small delay to ensure container is measured
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        const { cols, rows } = terminal;
        setTerminalSize(agentId, cols, rows);
        window.api.terminal.resize(agentId, cols, rows);
      } catch {
        // Ignore initial fit failures
      }
    });

    // Connect terminal input -> main process
    const inputDisposable = terminal.onData((data) => {
      window.api.terminal.write(agentId, data);
    });

    // Connect main process output -> terminal
    const unsubData = window.api.terminal.onData(agentId, (data) => {
      terminal.write(data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    setTerminalReady(agentId);
    onReady?.();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const { cols, rows } = terminal;
          setTerminalSize(agentId, cols, rows);
          window.api.terminal.resize(agentId, cols, rows);
        } catch {
          // Ignore resize errors
        }
      });
    });
    resizeObserver.observe(container);

    cleanupRef.current = () => {
      inputDisposable.dispose();
      unsubData();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [agentId, setTerminalReady, setTerminalSize, onReady, fontFamily, fontSize]);

  // Update terminal options when settings change (without re-creating)
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      terminalRef.current.options.fontFamily = fontFamily;
      fitAddonRef.current?.fit();
    }
  }, [fontSize, fontFamily]);

  // Handle external resize triggers
  useEffect(() => {
    const handleWindowResize = () => handleResize();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [handleResize]);

  return (
    <div
      ref={containerRef}
      className="terminal-container h-full w-full"
      style={{ background: "#0a0a0b" }}
    />
  );
}
