export type IdeType = "vscode" | "cursor" | "zed" | "windsurf" | "custom";

export type AgentCliConfig = {
  cliType: string;
  command: string;
  args: string[];
  env: Record<string, string>;
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
};
