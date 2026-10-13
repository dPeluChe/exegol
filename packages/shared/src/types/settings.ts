import { DEFAULT_DICTATION_SETTINGS, type DictationSettings } from "./dictation";
import type { IdeType } from "./ide";

export type AgentCliConfig = {
  cliType: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** One widget's placement; the array order is each zone's order */
export type StatusBarWidgetSetting = {
  id: string;
  on: boolean;
  /** Absent: the footer (every entry saved before the title bar had zones) */
  bar?: "footer" | "header";
  slot: "left" | "center" | "right";
  /** Resources widget: percentages, or used/total values for RAM */
  mode?: "percent" | "values";
};

/** Settings > General: suspend sessions idle this many days; 0 = Off */
export const IDLE_SUSPEND_DAYS = [0, 1, 3, 7, 14] as const;
export type IdleSuspendDays = (typeof IDLE_SUSPEND_DAYS)[number];

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
  /** Commit and push a worktree's pending work to its branch when its agent ends or before a sweep */
  saveWorktreeWork: boolean;
  /** T205: no PTY output and no input for this many days suspends an agent or closes a shell */
  idleSuspendDays: IdleSuspendDays;
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
  /** Local voice dictation (Settings > Dictation) */
  dictation: DictationSettings;
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
  saveWorktreeWork: true,
  idleSuspendDays: 7,
  mutedNotificationChannels: [],
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  mcpVerboseLogging: false,
  statusBarWidgets: [],
  dictation: DEFAULT_DICTATION_SETTINGS,
};
