/**
 * T145 — Writes the "exegol" entry into a spawned agent's `.mcp.json`
 * (the widely-adopted MCP client config convention — Claude Code, Cursor,
 * Windsurf all discover it in the CWD). Upserts only the "exegol" key,
 * exactly like T140's managed-block pattern: never touches other servers
 * the user has configured.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../lib/logger";
import type { ExegolAccessMode } from "./exegol-protocol";

const EXEGOL_SERVER_KEY = "exegol";

/**
 * Env var the per-DIRECTORY configs carry the token in — deliberately NOT
 * `EXEGOL_MCP_TOKEN`.
 *
 * Exegol already puts a per-SESSION `EXEGOL_MCP_TOKEN` in the PTY env
 * (agent-spawn-flow), which the CLI passes down to the MCP servers it spawns.
 * Writing the same var into a file that is shared by every session in a
 * directory OVERRODE that per-session value, so two agents in one repo
 * presented the same secret — Exegol created the identity collision it then
 * had to disambiguate. Under a different name the inherited per-session token
 * wins, and this one is only consulted when the CLI sanitizes its env (codex),
 * where a shared identity is still better than none.
 */
const FILE_TOKEN_ENV = "EXEGOL_MCP_TOKEN_FILE";

/** Token from a config file's env block, newest key first. The legacy key is
 *  still read so sessions spawned by an older build keep working. */
function tokenFromEnvBlock(env: Record<string, unknown> | undefined): string | null {
  for (const key of [FILE_TOKEN_ENV, "EXEGOL_MCP_TOKEN"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

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
    const dir = join(homedir(), ".exegol", "mcp");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${agentId}.json`);
    const body: McpJsonFile = {
      mcpServers: {
        [EXEGOL_SERVER_KEY]: {
          command: process.execPath,
          args: [shimPath],
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            [FILE_TOKEN_ENV]: token,
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
  const parsed = readMcpJson(join(homedir(), ".exegol", "mcp", `${agentId}.json`));
  const entry = parsed?.mcpServers?.[EXEGOL_SERVER_KEY] as
    | { env?: Record<string, unknown> }
    | undefined;
  return tokenFromEnvBlock(entry?.env);
}

export function removePerAgentMcpConfig(agentId: string): void {
  try {
    const path = join(homedir(), ".exegol", "mcp", `${agentId}.json`);
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

/** Resolve the bundled shim binary path — mirrors pty-sidecar-discovery's lookup. */
export function resolveMcpShimPath(): string {
  const primary = join(__dirname, "exegol-mcp-shim-bin.js");
  if (existsSync(primary)) return primary;
  return join(__dirname, "mcp", "exegol-mcp-shim-bin.js");
}

/** T175: the PreToolUse claim guard, resolved like the shim. Null when the
 *  bundle is missing, which simply means no enforcement rather than a broken
 *  hook command in the agent's settings file. */
export function resolveClaimGuardPath(): string | null {
  const primary = join(__dirname, "exegol-claim-guard-bin.js");
  if (existsSync(primary)) return primary;
  const nested = join(__dirname, "mcp", "exegol-claim-guard-bin.js");
  return existsSync(nested) ? nested : null;
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

/**
 * Write/update the "exegol" MCP server entry in `<cwd>/.mcp.json`.
 * Called for every non-shell agent spawn (shells skip this entirely).
 */
export function writeAgentMcpConfig(
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  const configPath = join(cwd, ".mcp.json");
  const existing = readMcpJson(configPath);
  if (existing === null) return; // unparseable — never clobber the user's servers

  const updated: McpJsonFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      [EXEGOL_SERVER_KEY]: {
        command: process.execPath,
        args: [shimPath],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          // The token IS the identity: the server maps it to agent/project
          // and re-reads access mode from the DB per call. EXEGOL_ACCESS_MODE
          // is a display-only hint for the shim's tools/list.
          [FILE_TOKEN_ENV]: token,
          EXEGOL_ACCESS_MODE: accessMode,
        },
      },
    },
  };

  try {
    writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to write .mcp.json:", err);
  }
}

// ─── T163: per-provider config writers ──────────────────────────────────────

/** opencode reads `<cwd>/opencode.json` — `mcp.<name>` with a command array. */
function writeOpencodeConfig(
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  const configPath = join(cwd, "opencode.json");
  const parsed = readMcpJson(configPath);
  if (parsed === null) return; // unparseable — never clobber the user's servers
  const existing = parsed as { mcp?: Record<string, unknown> };
  const updated = {
    ...existing,
    mcp: {
      ...existing.mcp,
      [EXEGOL_SERVER_KEY]: {
        type: "local",
        command: [process.execPath, shimPath],
        enabled: true,
        environment: {
          ELECTRON_RUN_AS_NODE: "1",
          [FILE_TOKEN_ENV]: token,
          EXEGOL_ACCESS_MODE: accessMode,
        },
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/** gemini-cli reads `<cwd>/.gemini/settings.json` — same mcpServers shape as .mcp.json. */
function writeGeminiConfig(
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  const configPath = join(cwd, ".gemini", "settings.json");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const existing = readMcpJson(configPath);
  if (existing === null) return; // unparseable — never clobber the user's servers
  const updated: McpJsonFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      [EXEGOL_SERVER_KEY]: {
        command: process.execPath,
        args: [shimPath],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          [FILE_TOKEN_ENV]: token,
          EXEGOL_ACCESS_MODE: accessMode,
        },
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/** devin reads `<cwd>/.devin/mcp_config.local.json` (project-local, uncommitted
 *  by convention) — standard mcpServers shape, verified against a live user
 *  config 2026-08-12. */
function writeDevinConfig(
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  const configPath = join(cwd, ".devin", "mcp_config.local.json");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const existing = readMcpJson(configPath);
  if (existing === null) return; // unparseable — never clobber the user's servers
  const updated: McpJsonFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      [EXEGOL_SERVER_KEY]: {
        command: process.execPath,
        args: [shimPath],
        disabled: false,
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          [FILE_TOKEN_ENV]: token,
          EXEGOL_ACCESS_MODE: accessMode,
        },
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/** agy (Antigravity CLI) reads `<cwd>/.agents/mcp_config.json` — workspace-local,
 *  standard mcpServers shape (docs: antigravity.google/docs/cli/mcp). It has no
 *  `mcp add` command: the file is the interface, and `/mcp` reloads it. */
function writeAgyConfig(
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  const configPath = join(cwd, ".agents", "mcp_config.json");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const existing = readMcpJson(configPath);
  if (existing === null) return; // unparseable — never clobber the user's servers
  const updated: McpJsonFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      [EXEGOL_SERVER_KEY]: {
        command: process.execPath,
        args: [shimPath],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          [FILE_TOKEN_ENV]: token,
          EXEGOL_ACCESS_MODE: accessMode,
        },
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
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
  const start = existing.indexOf(CODEX_MARK_START);
  const end = existing.indexOf(CODEX_MARK_END);
  let updated: string;
  if (start !== -1 && end !== -1) {
    updated = existing.slice(0, start) + block + existing.slice(end + CODEX_MARK_END.length);
  } else {
    updated = existing.trimEnd() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  if (updated !== existing) writeFileSync(configPath, updated, "utf-8");
}

/**
 * T163 entry point: wire the exegol MCP server for the given provider.
 * Unknown/custom CLIs get the `.mcp.json` convention — harmless if unread.
 */
/**
 * These files live in the user's repo and carry a credential. We must NOT
 * gitignore them ourselves — `opencode.json` and `.mcp.json` are legitimate
 * project config a team may want committed, and Exegol only inserts its own
 * `exegol` key. So: say it loudly instead, once per spawn, and let the user
 * decide (Juanito, 2026-08-13: "es cuestión de tiempo hasta que alguien lo
 * commitee"). The real fix is to stop writing the token here at all — see
 * T170: wherever the CLI forwards its env, the per-session token already
 * arrives through the PTY and this file needs no secret.
 */
function warnIfCommittable(cwd: string, relPath: string): void {
  // Async: this rides the spawn path, and a blocking `git` call there would
  // stall the main process (and every PTY it pumps) for a log line.
  execFile("git", ["check-ignore", "-q", relPath], { cwd, timeout: 1_000 }, (err) => {
    // exit 1 = not ignored (a real answer); anything else = not a repo / no git.
    if (!err || (err as { code?: number }).code !== 1) return;
    logger.warn(
      `[ExegolMcp] ${relPath} holds an Exegol MCP token and is NOT gitignored in ${cwd} — add it to .gitignore so the credential can't be committed`,
    );
  });
}

export function writeAgentMcpConfigFor(
  cliType: string,
  cwd: string,
  shimPath: string,
  token: string,
  accessMode: ExegolAccessMode,
): void {
  try {
    switch (flavorForCli(cliType)) {
      case "opencode":
        writeOpencodeConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, "opencode.json");
        return;
      case "devin":
        writeDevinConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, ".devin/mcp_config.local.json");
        return;
      case "agy":
        writeAgyConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, ".agents/mcp_config.json");
        return;
      case "gemini":
        writeGeminiConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, ".gemini/settings.json");
        return;
      case "codex-global":
        ensureCodexGlobalConfig(shimPath);
        // codex launches MCP servers with a SANITIZED env (verified live
        // 2026-08-12: shim got no EXEGOL_MCP_TOKEN → read-mode tools). The
        // token must live on disk: codex ignores .mcp.json but the shim
        // reads it from its cwd as a fallback — and reattach token re-arm
        // works for codex again via readAgentMcpToken.
        writeAgentMcpConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, ".mcp.json");
        return;
      default:
        writeAgentMcpConfig(cwd, shimPath, token, accessMode);
        warnIfCommittable(cwd, ".mcp.json");
    }
  } catch (err) {
    logger.warn(`[ExegolMcp] Failed to write MCP config for ${cliType}:`, err);
  }
}

/** Read the exegol token back from a cwd's provider configs — used on reattach
 *  to re-arm the (in-memory) token registry after an app restart. Codex has no
 *  on-disk token (env-inherited), so reattached codex agents get a fresh one
 *  via registerAgentMcpToken... which their running shim can't know — codex
 *  loses MCP across app restarts until the session restarts (documented gap). */
export function readAgentMcpToken(cwd: string): string | null {
  const mcpJson = readMcpJson(join(cwd, ".mcp.json"))?.mcpServers?.[EXEGOL_SERVER_KEY] as
    | { env?: Record<string, unknown> }
    | undefined;
  const opencode = (
    readMcpJson(join(cwd, "opencode.json")) as { mcp?: Record<string, unknown> } | null
  )?.mcp?.[EXEGOL_SERVER_KEY] as { environment?: Record<string, unknown> } | undefined;
  const gemini = readMcpJson(join(cwd, ".gemini", "settings.json"))?.mcpServers?.[
    EXEGOL_SERVER_KEY
  ] as { env?: Record<string, unknown> } | undefined;
  const devin = readMcpJson(join(cwd, ".devin", "mcp_config.local.json"))?.mcpServers?.[
    EXEGOL_SERVER_KEY
  ] as { env?: Record<string, unknown> } | undefined;
  const agy = readMcpJson(join(cwd, ".agents", "mcp_config.json"))?.mcpServers?.[
    EXEGOL_SERVER_KEY
  ] as { env?: Record<string, unknown> } | undefined;

  for (const env of [mcpJson?.env, opencode?.environment, gemini?.env, devin?.env, agy?.env]) {
    const token = tokenFromEnvBlock(env);
    if (token) return token;
  }
  return null;
}

/** Best-effort removal of the exegol entry on agent exit — the token is
 *  revoked anyway, but a dead entry pollutes the repo if committed.
 *  Covers .mcp.json, opencode.json and .gemini/settings.json; the codex
 *  global entry is static (tokenless) and intentionally stays. */
export function removeAgentMcpConfig(cwd: string): void {
  removeFromJsonConfig(join(cwd, ".mcp.json"), "mcpServers");
  removeFromJsonConfig(join(cwd, "opencode.json"), "mcp");
  removeFromJsonConfig(join(cwd, ".gemini", "settings.json"), "mcpServers");
  removeFromJsonConfig(join(cwd, ".devin", "mcp_config.local.json"), "mcpServers");
  removeFromJsonConfig(join(cwd, ".agents", "mcp_config.json"), "mcpServers");
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
