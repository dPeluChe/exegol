import type { AgentProvider } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";

// ─── Default Built-in Providers ─────────────────────────────────────────────

const BUILTIN_PROVIDERS: AgentProvider[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "C",
    color: "#D97706",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "--continue",
      supportsRPC: false,
      supportsVision: true,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "Co",
    color: "#10B981",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "resume --last",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    args: [],
    env: {},
    argsTemplate: "{command}",
    icon: "G",
    color: "#3B82F6",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "--resume",
      supportsRPC: false,
      supportsVision: true,
      supportsPromptArg: false,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    args: [],
    env: {},
    argsTemplate: "{command} --message '{task}'",
    icon: "A",
    color: "#8B5CF6",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "--restore-chat-history",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: false,
      promptFlag: "--message",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "goose",
    name: "Goose",
    command: "goose",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "Go",
    color: "#F97316",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "session --resume",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: [],
    env: {},
    argsTemplate: "{command}",
    icon: "OC",
    color: "#EC4899",
    capabilities: {
      supportsWorktree: true,
      supportsResume: true,
      resumeFlag: "--continue",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: false,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "amp",
    name: "Amp",
    command: "amp",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "Am",
    color: "#06B6D4",
    capabilities: {
      supportsWorktree: false,
      supportsResume: false,
      resumeFlag: "",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "kiro",
    name: "Kiro",
    command: "kiro-cli",
    args: [],
    env: {},
    argsTemplate: "{command} chat",
    icon: "K",
    color: "#84CC16",
    capabilities: {
      supportsWorktree: false,
      supportsResume: true,
      resumeFlag: "chat --resume",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: false,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "kilocode",
    name: "Kilo Code",
    command: "kilocode",
    args: [],
    env: {},
    argsTemplate: "{command}",
    icon: "KC",
    color: "#7C3AED",
    capabilities: {
      supportsWorktree: false,
      supportsResume: false,
      resumeFlag: "",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: false,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "crush",
    name: "Crush",
    command: "crush",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "Cr",
    color: "#F472B6",
    capabilities: {
      supportsWorktree: false,
      supportsResume: true,
      resumeFlag: "--continue",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "factory-droid",
    name: "Factory Droid",
    command: "droid",
    args: [],
    env: {},
    argsTemplate: "{command} '{task}'",
    icon: "FD",
    color: "#1E90FF",
    capabilities: {
      supportsWorktree: false,
      supportsResume: false,
      resumeFlag: "",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: true,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "shell",
    name: "Terminal",
    command: "__shell__",
    args: [],
    env: {},
    argsTemplate: "",
    icon: ">_",
    color: "#6B7280",
    capabilities: {
      supportsWorktree: false,
      supportsResume: false,
      resumeFlag: "",
      supportsRPC: false,
      supportsVision: false,
      supportsPromptArg: false,
      promptFlag: "",
    },
    isBuiltin: true,
    enabled: true,
  },
];

const CUSTOM_PROVIDERS_SETTINGS_KEY = "custom_providers";
const PROVIDER_OVERRIDES_KEY = "provider_overrides";

// ─── Registry Singleton ─────────────────────────────────────────────────────

let instance: AgentProviderRegistry | null = null;

export function getProviderRegistry(): AgentProviderRegistry {
  if (!instance) {
    instance = new AgentProviderRegistry();
  }
  return instance;
}

export class AgentProviderRegistry {
  private providers: Map<string, AgentProvider> = new Map();

  constructor() {
    // Load builtins
    for (const provider of BUILTIN_PROVIDERS) {
      this.providers.set(provider.id, provider);
    }
  }

  /** Load custom providers + built-in overrides from DB settings */
  loadFromDb(db: Database.Database): void {
    try {
      // Load custom providers
      const customRow = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(CUSTOM_PROVIDERS_SETTINGS_KEY) as { value: string } | undefined;
      if (customRow) {
        const customs = JSON.parse(customRow.value) as AgentProvider[];
        for (const provider of customs) {
          this.providers.set(provider.id, { ...provider, isBuiltin: false });
        }
        logger.info(`[Registry] Loaded ${customs.length} custom providers from DB`);
      }

      // Load built-in overrides (args, enabled)
      const overridesRow = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(PROVIDER_OVERRIDES_KEY) as { value: string } | undefined;
      if (overridesRow) {
        const overrides = JSON.parse(overridesRow.value) as Record<
          string,
          { args: string[]; enabled: boolean }
        >;
        for (const [id, override] of Object.entries(overrides)) {
          const provider = this.providers.get(id);
          if (provider) {
            provider.args = override.args;
            provider.enabled = override.enabled;
          }
        }
      }
    } catch (err) {
      logger.error("[Registry] Failed to load providers:", err);
    }
  }

  /** Save custom providers to DB settings */
  saveCustomToDb(db: Database.Database): void {
    const customs = this.listCustom();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      CUSTOM_PROVIDERS_SETTINGS_KEY,
      JSON.stringify(customs),
    );
    // Also save overrides for built-in providers (args, enabled)
    const overrides: Record<string, { args: string[]; enabled: boolean }> = {};
    for (const p of this.listBuiltin()) {
      if (p.args.length > 0 || p.enabled === false) {
        overrides[p.id] = { args: p.args, enabled: p.enabled };
      }
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      PROVIDER_OVERRIDES_KEY,
      JSON.stringify(overrides),
    );
  }

  /** Get a provider by ID */
  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  /** List all registered providers */
  list(): AgentProvider[] {
    return Array.from(this.providers.values());
  }

  /** List only built-in providers */
  listBuiltin(): AgentProvider[] {
    return this.list().filter((p) => p.isBuiltin);
  }

  /** List only custom providers */
  listCustom(): AgentProvider[] {
    return this.list().filter((p) => !p.isBuiltin);
  }

  /** Swap two providers by ID (for reordering). Persists to DB. */
  swap(db: Database.Database, idA: string, idB: string): boolean {
    const list = Array.from(this.providers.entries());
    const indexA = list.findIndex(([id]) => id === idA);
    const indexB = list.findIndex(([id]) => id === idB);
    if (indexA === -1 || indexB === -1) return false;
    // biome-ignore lint/style/noNonNullAssertion: bounds checked above
    [list[indexA], list[indexB]] = [list[indexB]!, list[indexA]!];
    this.providers = new Map(list);
    this.saveCustomToDb(db);
    return true;
  }

  /** Register a custom provider */
  register(db: Database.Database, provider: Omit<AgentProvider, "isBuiltin">): AgentProvider {
    const full: AgentProvider = { ...provider, isBuiltin: false };
    this.providers.set(full.id, full);
    this.saveCustomToDb(db);
    logger.info(`[Registry] Registered custom provider: ${full.name}`);
    return full;
  }

  /** Remove a custom provider (builtins cannot be removed) */
  unregister(db: Database.Database, id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider || provider.isBuiltin) return false;
    this.providers.delete(id);
    this.saveCustomToDb(db);
    logger.info(`[Registry] Unregistered custom provider: ${id}`);
    return true;
  }

  /** Check if a given task description is just a CLI quick-launch label */
  isQuickLaunchLabel(description: string): boolean {
    const lower = description.toLowerCase();
    for (const provider of this.providers.values()) {
      if (lower === provider.name.toLowerCase() || lower === provider.id.toLowerCase()) {
        return true;
      }
    }
    return lower === "custom";
  }

  /** Resolve CLI config from a provider ID (backwards-compat with AgentCliConfig) */
  resolveCliConfig(
    cliType: string,
  ): { command: string; args: string[]; env: Record<string, string> } | null {
    const provider = this.providers.get(cliType);
    if (!provider) return null;
    return { command: provider.command, args: provider.args, env: provider.env };
  }
}
