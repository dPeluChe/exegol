/**
 * T145 — Writes the "exegol" entry into a spawned agent's `.mcp.json`
 * (the widely-adopted MCP client config convention — Claude Code, Cursor,
 * Windsurf all discover it in the CWD). Upserts only the "exegol" key,
 * exactly like T140's managed-block pattern: never touches other servers
 * the user has configured.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { excludeFromGit } from "../lib/git-exclude";
import { logger } from "../lib/logger";
import {
  removeTokenFile,
  SESSION_TOKEN_ENV,
  TOKEN_PATH_ENV,
  tokenFromEnvBlock,
  writeTokenFile,
} from "./exegol-mcp-token-file";
import type { ExegolAccessMode } from "./exegol-protocol";

const EXEGOL_SERVER_KEY = "exegol";

export const MCP_CONFIG_DIR = join(homedir(), ".exegol", "mcp");

/**
 * T166: per-AGENT MCP config, outside the repo (~/.exegol/mcp/<agentId>.json).
 * The cwd-scoped files are per-DIRECTORY, so two agents working the same repo
 * (the build+review pair — the whole point of Exegol) shared one token and one
 * identity. claude takes `--mcp-config <file>` and codex takes `-c key=value`,
 * so each session can carry its own credential with no shared file at all.
 */
export function writePerAgentMcpConfig(
  agentId: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): string | null {
  try {
    mkdirSync(MCP_CONFIG_DIR, { recursive: true, mode: 0o700 });
    const path = join(MCP_CONFIG_DIR, `${agentId}.json`);
    const body: McpJsonFile = {
      mcpServers: {
        [EXEGOL_SERVER_KEY]: {
          command: process.execPath,
          args: [shimPath],
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            // Outside any repo, so the token stays inline
            [SESSION_TOKEN_ENV]: token,
            EXEGOL_ACCESS_MODE: accessMode,
          },
        },
      },
    };
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    return path;
  } catch (err) {
    logger.warn(`[ExegolMcp] Failed to write per-agent MCP config for ${agentId}:`, err);
    return null;
  }
}

/** Read an agent's own token — deterministic, no cwd guessing (reattach). */
export function readPerAgentMcpToken(agentId: string): string | null {
  const parsed = readMcpJson(join(MCP_CONFIG_DIR, `${agentId}.json`));
  const entry = parsed?.mcpServers?.[EXEGOL_SERVER_KEY] as
    | { env?: Record<string, unknown> }
    | undefined;
  return tokenFromEnvBlock(entry?.env);
}

export function removePerAgentMcpConfig(agentId: string): void {
  try {
    const path = join(MCP_CONFIG_DIR, `${agentId}.json`);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** T163: which config each provider reads. Everything else falls back to the
 *  `.mcp.json` convention (Claude Code, Cursor, Windsurf all discover it). */
type McpConfigFlavor = "mcp-json" | "opencode" | "gemini" | "codex-global" | "devin" | "agy";

function flavorForCli(cliType: string): McpConfigFlavor {
  if (cliType === "opencode") return "opencode";
  if (cliType === "gemini") return "gemini";
  if (cliType === "codex") return "codex-global";
  if (cliType === "devin") return "devin";
  if (cliType === "agy") return "agy";
  return "mcp-json";
}

/** Providers whose CLI reads the config Exegol writes for it. The `.mcp.json` fallback is written
 *  for every provider but only Claude Code among them is known to load it */
export function readsExegolMcpConfig(cliType: string): boolean {
  return cliType === "claude-code" || flavorForCli(cliType) !== "mcp-json";
}

/** Bundled bins sit beside this file in prod and under mcp/ in dev builds. */
function resolveBundledBin(fileName: string): string | null {
  const primary = join(__dirname, fileName);
  if (existsSync(primary)) return primary;
  const nested = join(__dirname, "mcp", fileName);
  return existsSync(nested) ? nested : null;
}

const SHIM_BIN = "exegol-mcp-shim-bin.js";

export function resolveMcpShimPath(): string {
  return resolveBundledBin(SHIM_BIN) ?? join(__dirname, "mcp", SHIM_BIN);
}

/** T175: the PreToolUse claim guard. Null when the bundle is missing, which
 *  means no enforcement rather than a broken hook command in the settings file. */
export function resolveClaimGuardPath(): string | null {
  return resolveBundledBin("exegol-claim-guard-bin.js");
}

interface McpJsonFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Returns null when the file exists but can't be parsed — callers must NOT
 *  overwrite in that case or the user's other MCP servers are destroyed
 *  (opencode.json / .gemini/settings.json are hand-edited and may be JSONC). */
function readMcpJson(path: string): McpJsonFile | null {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as McpJsonFile;
  } catch (err) {
    logger.warn(`[ExegolMcp] ${path} is not valid JSON — leaving it untouched:`, err);
    return null;
  }
}

const CODEX_MARK_START = "# >>> exegol managed — do not edit >>>";
const CODEX_MARK_END = "# <<< exegol managed <<<";

/**
 * codex reads only the GLOBAL `~/.codex/config.toml` — so the entry is static
 * and carries NO token: each codex agent's shim (spawned as codex's child)
 * inherits EXEGOL_MCP_TOKEN from the env Exegol set at spawn. Managed-marker
 * block, idempotent, never touches the rest of the user's config.
 */
function ensureCodexGlobalConfig(shimPath: string): void {
  const configPath = join(homedir(), ".codex", "config.toml");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const block = [
    CODEX_MARK_START,
    `[mcp_servers.${EXEGOL_SERVER_KEY}]`,
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(shimPath)}]`,
    `env = { "ELECTRON_RUN_AS_NODE" = "1" }`,
    CODEX_MARK_END,
  ].join("\n");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const updated = withCodexExegolBlock(existing, block);
  if (updated !== existing) writeFileSync(configPath, updated, "utf-8");
}

/**
 * The config with exactly one Exegol block, at the end. The Codex app rewrites this file: it
 * moved the table among the other mcp_servers (env as its own `.env` table) and left a stray
 * end marker before our start, which made every launch append a copy; codex then refused the
 * duplicate key. So drop every marker line and every `mcp_servers.exegol` table wherever it is.
 */
export function withCodexExegolBlock(existing: string, block: string): string {
  const header = new RegExp(`^\\[mcp_servers\\.${EXEGOL_SERVER_KEY}(\\]|\\.)`);
  const kept: string[] = [];
  let inExegolTable = false;
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === CODEX_MARK_START || trimmed === CODEX_MARK_END) continue;
    if (trimmed.startsWith("[")) inExegolTable = header.test(trimmed);
    if (!inExegolTable) kept.push(line);
  }
  const rest = kept.join("\n").trimEnd();
  return rest ? `${rest}\n\n${block}\n` : `${block}\n`;
}

type ProjectFlavor = Exclude<McpConfigFlavor, "codex-global">;

interface ProjectConfig {
  relPath: string;
  section: "mcpServers" | "mcp";
  envKey: "env" | "environment";
  /** The exegol entry without its env block, which goes last under `envKey` */
  entry: (shimPath: string) => Record<string, unknown>;
}

const stdioEntry = (shimPath: string) => ({ command: process.execPath, args: [shimPath] });

/** T163: the project file each CLI reads, all with the `.mcp.json`-style entry but opencode */
const PROJECT_CONFIGS: Record<ProjectFlavor, ProjectConfig> = {
  "mcp-json": { relPath: ".mcp.json", section: "mcpServers", envKey: "env", entry: stdioEntry },
  // `mcp.<name>` with a command array
  opencode: {
    relPath: "opencode.json",
    section: "mcp",
    envKey: "environment",
    entry: (shimPath) => ({ type: "local", command: [process.execPath, shimPath], enabled: true }),
  },
  gemini: {
    relPath: ".gemini/settings.json",
    section: "mcpServers",
    envKey: "env",
    entry: stdioEntry,
  },
  // Project-local, uncommitted by convention; verified against a live config 2026-08-12
  devin: {
    relPath: ".devin/mcp_config.local.json",
    section: "mcpServers",
    envKey: "env",
    entry: (shimPath) => ({ ...stdioEntry(shimPath), disabled: false }),
  },
  // Antigravity: no `mcp add`, the file is the interface and `/mcp` reloads it
  agy: {
    relPath: ".agents/mcp_config.json",
    section: "mcpServers",
    envKey: "env",
    entry: stdioEntry,
  },
};

/** The token IS the identity: the server maps it to agent/project and re-reads access mode
 *  from the DB per call; EXEGOL_ACCESS_MODE only shapes the shim's tools/list */
function exegolEnv(tokenPath: string, accessMode: ExegolAccessMode): Record<string, string> {
  return {
    ELECTRON_RUN_AS_NODE: "1",
    [TOKEN_PATH_ENV]: tokenPath,
    EXEGOL_ACCESS_MODE: accessMode,
  };
}

/** Upserts only the exegol entry; an unparseable file is left alone (and no token written) */
function writeProjectMcpConfig(
  config: ProjectConfig,
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): "created" | "updated" | "skipped" {
  const configPath = join(cwd, config.relPath);
  const existed = existsSync(configPath);
  const existing = readMcpJson(configPath) as Record<string, unknown> | null;
  if (existing === null) return "skipped";
  const tokenPath = writeTokenFile(cwd, token);
  logger.info(`[ExegolMcp] token file written for ${basename(cwd)}`);
  const updated = {
    ...existing,
    [config.section]: {
      ...(existing[config.section] as Record<string, unknown> | undefined),
      [EXEGOL_SERVER_KEY]: {
        ...config.entry(shimPath),
        [config.envKey]: exegolEnv(tokenPath, accessMode),
      },
    },
  };
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return existed ? "updated" : "created";
}

/**
 * T163 entry point: wire the exegol MCP server for the given provider.
 * Unknown/custom CLIs get the `.mcp.json` convention — harmless if unread.
 */
export function writeAgentMcpConfigFor(
  cliType: string,
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  try {
    const flavor = flavorForCli(cliType);
    // codex launches MCP servers with a SANITIZED env (verified live 2026-08-12):
    // it ignores .mcp.json, but the shim reads it from its cwd as a fallback.
    if (flavor === "codex-global") ensureCodexGlobalConfig(shimPath);
    const config = PROJECT_CONFIGS[flavor === "codex-global" ? "mcp-json" : flavor];
    const outcome = writeProjectMcpConfig(config, cwd, shimPath, token, accessMode);
    if (outcome === "created") excludeFromGit(cwd, config.relPath);
  } catch (err) {
    logger.warn(`[ExegolMcp] Failed to write MCP config for ${cliType}:`, err);
  }
}

/** Read the exegol token back from a cwd's provider configs, through the token file
 *  they name (or an older build's inline token): reattach re-arms the in-memory
 *  token registry with it after an app restart. */
export function readAgentMcpToken(cwd: string): string | null {
  for (const config of Object.values(PROJECT_CONFIGS)) {
    const file = readMcpJson(join(cwd, config.relPath)) as Record<string, unknown> | null;
    const section = file?.[config.section] as Record<string, unknown> | undefined;
    const entry = section?.[EXEGOL_SERVER_KEY] as Record<string, unknown> | undefined;
    const token = tokenFromEnvBlock(entry?.[config.envKey] as Record<string, unknown> | undefined);
    if (token) return token;
  }
  return null;
}

/** Best-effort removal of the exegol entry and the directory's token file once no
 *  live agent works there. The codex global entry is static (tokenless) and stays. */
export function removeAgentMcpConfig(cwd: string): void {
  removeTokenFile(cwd);
  for (const config of Object.values(PROJECT_CONFIGS)) {
    removeFromJsonConfig(join(cwd, config.relPath), config.section);
  }
}
function removeFromJsonConfig(configPath: string, sectionKey: string): void {
  if (!existsSync(configPath)) return;
  try {
    const parsedExisting = readMcpJson(configPath);
    if (parsedExisting === null) return;
    const existing = parsedExisting as Record<string, unknown>;
    const servers = existing[sectionKey] as Record<string, unknown> | undefined;
    if (!servers || !(EXEGOL_SERVER_KEY in servers)) return;
    const { [EXEGOL_SERVER_KEY]: _removed, ...rest } = servers;
    if (Object.keys(rest).length === 0 && Object.keys(existing).length === 1) {
      unlinkSync(configPath);
      return;
    }
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...existing, [sectionKey]: rest }, null, 2)}\n`,
      "utf-8",
    );
  } catch (err) {
    logger.warn(`[ExegolMcp] Failed to clean ${configPath}:`, err);
  }
}
