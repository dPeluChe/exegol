export interface TerminalInstanceHandle {
  serialize: () => string | null;
  refit: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getSelection: () => string;
  clear: () => void;
}

export interface TerminalInstanceProps {
  agentId: string;
  cliType?: string;
  readOnly?: boolean;
  initialContent?: string;
  onReady?: () => void;
  onScrollPosition?: (atTop: boolean, atBottom: boolean) => void;
}

/** TUI CLIs that break with WebGL renderer (alternate screen buffer issues) */
export const CANVAS_ONLY_CLI_TYPES = new Set(["crush", "opencode", "kiro", "gemini"]);

export const DARK_TERMINAL_THEME = {
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

export const DARK_BLACK_TERMINAL_THEME = {
  ...DARK_TERMINAL_THEME,
  background: "#000000",
  cursorAccent: "#000000",
  black: "#000000",
};

export const LIGHT_TERMINAL_THEME = {
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
