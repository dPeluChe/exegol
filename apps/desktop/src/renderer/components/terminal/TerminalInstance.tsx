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
  useState,
} from "react";
import { useSettings } from "../../hooks/use-trpc";
import { useTerminalStore } from "../../stores/terminals";

export interface TerminalInstanceHandle {
  serialize: () => string | null;
  refit: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getSelection: () => string;
}

interface TerminalInstanceProps {
  agentId: string;
  readOnly?: boolean;
  initialContent?: string;
  onReady?: () => void;
  /** Called when scroll position changes: atTop, atBottom */
  onScrollPosition?: (atTop: boolean, atBottom: boolean) => void;
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

const DARK_BLACK_TERMINAL_THEME = {
  ...DARK_TERMINAL_THEME,
  background: "#000000",
  cursorAccent: "#000000",
  black: "#000000",
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
  { agentId, readOnly = false, initialContent, onReady, onScrollPosition }: TerminalInstanceProps,
  ref: ForwardedRef<TerminalInstanceHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  // Expose serialize + refit methods to parent via ref
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
  const terminalTheme = isLight
    ? LIGHT_TERMINAL_THEME
    : theme === "dark-black"
      ? DARK_BLACK_TERMINAL_THEME
      : DARK_TERMINAL_THEME;

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: onScrollPosition is stable (useCallback), adding it would remount the entire terminal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: terminalTheme,
      fontSize,
      fontFamily,
      cursorBlink: !readOnly,
      cursorStyle: "bar",
      scrollback: 5_000,
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

    // WebGL loaded later by visibility observer (T38)

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
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    if (!readOnly) {
      // Ctrl+Backspace → send \x17 (ETB = erase word) instead of single backspace
      terminal.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Backspace" && (e.ctrlKey || e.metaKey)) {
          window.api.terminal.write(agentId, "\x17");
          return false;
        }
        return true;
      });

      // Image paste: save clipboard image as temp file, paste path into terminal
      const handlePaste = async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            const filePath = await window.api.terminal.saveClipboardImage();
            if (filePath) window.api.terminal.write(agentId, filePath);
            return;
          }
        }
      };
      container.addEventListener("paste", handlePaste);
      disposables.push({ dispose: () => container.removeEventListener("paste", handlePaste) });

      // Connect terminal input -> main process
      disposables.push(
        terminal.onData((data) => {
          window.api.terminal.write(agentId, data);
        }),
      );

      // Connect main process output -> terminal (5ms coalescing to reduce partial-render artifacts)
      let coalescedData = "";
      const flushCoalesced = (): void => {
        if (coalescedData.length > 0) {
          terminal.write(coalescedData);
          coalescedData = "";
        }
        coalesceTimer = null;
      };
      unsubData = window.api.terminal.onData(agentId, (data) => {
        coalescedData += data;
        if (!coalesceTimer) {
          coalesceTimer = setTimeout(flushCoalesced, 5);
        }
      });
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    setTerminalReady(agentId);
    onReady?.();

    // Scroll position reporting for navigation buttons
    if (onScrollPosition) {
      const checkScroll = () => {
        const buf = terminal.buffer.active;
        const atTop = buf.viewportY === 0;
        const atBottom = buf.viewportY >= buf.baseY;
        onScrollPosition(atTop, atBottom);
      };
      disposables.push(terminal.onScroll(checkScroll));
      // Also check after writes (new content may change position)
      disposables.push(terminal.onWriteParsed(checkScroll));
    }

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
      if (coalesceTimer) clearTimeout(coalesceTimer);
      for (const d of disposables) d.dispose();
      unsubData?.();
      resizeObserver.disconnect();
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
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

  // T38: WebGL context pooling — load/unload WebGL based on viewport visibility
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

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (isVisible && !webglAddonRef.current) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          webglAddonRef.current = null;
        });
        terminal.loadAddon(webgl);
        webglAddonRef.current = webgl;
      } catch {
        /* WebGL not supported — canvas fallback */
      }
    } else if (!isVisible && webglAddonRef.current) {
      webglAddonRef.current.dispose();
      webglAddonRef.current = null;
    }
  }, [isVisible]);

  // Rule 4: external system sync — window resize + tab-switch refit listener
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

  return <div ref={containerRef} className="terminal-container h-full w-full bg-bg-primary" />;
});
