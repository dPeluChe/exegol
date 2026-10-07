import type { IdeType } from "./ide";

export type AgentCliConfig = {
  cliType: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** One status bar widget's placement; the array order is the bar's order */
export type StatusBarWidgetSetting = {
  id: string;
  on: boolean;
  slot: "left" | "center" | "right";
};

export type Settings = {
  defaultIde: IdeType;
  customIdePath: string | null;
  theme: "dark" | "dark-black" | "light" | "system";
  agentClis: AgentCliConfig[];
  globalHotkey: string;
  terminalFontSize: number;
  terminalFontFamily: string;
  notificationsEnabled: boolean;
  toastsEnabled: boolean;
  /** T155.7: per-channel notification kill switches (NotificationMuteChannel ids) */
  mutedNotificationChannels: string[];
  /** Ollama server URL for local embeddings */
  ollamaUrl: string;
  /** Ollama embedding model name */
  ollamaModel: string;
  /** T163: write per-call Exegol MCP server lines to the backend log. The
   *  in-app activity view works regardless — this is the noisy channel. */
  mcpVerboseLogging: boolean;
  /** Empty: the built-in widgets at their defaults */
  statusBarWidgets: StatusBarWidgetSetting[];
};

export const DEFAULT_SETTINGS: Settings = {
  defaultIde: "vscode",
  customIdePath: null,
  theme: "dark",
  agentClis: [
    { cliType: "claude-code", command: "claude", args: [], env: {} },
    { cliType: "codex", command: "codex", args: [], env: {} },
    { cliType: "aider", command: "aider", args: [], env: {} },
    { cliType: "gemini", command: "gemini", args: [], env: {} },
  ],
  globalHotkey: "CommandOrControl+Shift+E",
  terminalFontSize: 14,
  terminalFontFamily: "Menlo, Monaco, monospace",
  notificationsEnabled: true,
  toastsEnabled: true,
  mutedNotificationChannels: [],
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  mcpVerboseLogging: false,
  statusBarWidgets: [],
};
