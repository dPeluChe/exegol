import type { InterruptionLevel } from "./agent-signals";
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

/** Settings > General: alert when a turn runs longer than this many minutes; 0 = Off */
export const STUCK_TURN_PRESETS = [0, 30, 60, 120, 240] as const;
export const STUCK_TURN_MIN = 5;
export const STUCK_TURN_MAX = 7 * 24 * 60;

export type Settings = {
  defaultIde: IdeType;
  customIdePath: string | null;
  theme: "dark" | "dark-black" | "light" | "system";
  agentClis: AgentCliConfig[];
  globalHotkey: string;
  terminalFontSize: number;
  terminalFontFamily: string;
  /** Send to a plain terminal also presses Enter (runs it); off = paste only */
  sendToRunTerminal: boolean;
  /** Send to an agent also presses Enter (submits it), never over a question on screen */
  sendToSubmitAgent: boolean;
  notificationsEnabled: boolean;
  toastsEnabled: boolean;
  /** Commit and push a worktree's pending work to its branch when its agent ends or before a sweep */
  saveWorktreeWork: boolean;
  /** Daily: remove node_modules, build output and caches of Exegol worktrees idle for a day */
  worktreeJanitor: boolean;
  /** T205: no PTY output and no input for this many days suspends an agent or closes a shell */
  idleSuspendDays: IdleSuspendDays;
  /** T200.10: a turn running longer than this (or silent 10 min) raises an attention item; 0 = Off */
  stuckTurnAlertMinutes: number;
  /** T155.7: per-channel notification kill switches (NotificationMuteChannel ids) */
  mutedNotificationChannels: string[];
  /** Per project; a project left out is "all" */
  projectInterruption: Record<string, InterruptionLevel>;
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
  sendToRunTerminal: false,
  sendToSubmitAgent: false,
  notificationsEnabled: true,
  toastsEnabled: true,
  saveWorktreeWork: true,
  worktreeJanitor: true,
  idleSuspendDays: 7,
  stuckTurnAlertMinutes: 0,
  mutedNotificationChannels: [],
  projectInterruption: {},
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  mcpVerboseLogging: false,
  statusBarWidgets: [],
  dictation: DEFAULT_DICTATION_SETTINGS,
};
