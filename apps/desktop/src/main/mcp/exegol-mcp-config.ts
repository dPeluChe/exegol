/**
 * T145 — Writes the "exegol" entry into a spawned agent's `.mcp.json`
 * (the widely-adopted MCP client config convention — Claude Code, Cursor,
 * Windsurf all discover it in the CWD). Upserts only the "exegol" key,
 * exactly like T140's managed-block pattern: never touches other servers
 * the user has configured.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../lib/logger";
import type { ExegolAccessMode } from "./exegol-protocol";

const EXEGOL_SERVER_KEY = "exegol";

/** T163: which config each provider reads. Everything else falls back to the
 *  `.mcp.json` convention (Claude Code, Cursor, Windsurf all discover it). */
type McpConfigFlavor = "mcp-json" | "opencode" | "gemini" | "codex-global" | "devin";

function flavorForCli(cliType: string): McpConfigFlavor {
  if (cliType === "opencode") return "opencode";
  if (cliType === "gemini") return "gemini";
  if (cliType === "codex") return "codex-global";
  if (cliType === "devin") return "devin";
  // agy (Antigravity CLI) has NO MCP support as of 2026-08 (no mcp subcommand,
  // no config surface) — it can still RECEIVE agent messages via PTY injection.
  // Recheck on agy updates. Everything else gets the .mcp.json convention.
  return "mcp-json";
}

/** Resolve the bundled shim binary path — mirrors pty-sidecar-discovery's lookup. */
export function resolveMcpShimPath(): string {
  const primary = join(__dirname, "exegol-mcp-shim-bin.js");
  if (existsSync(primary)) return primary;
  return join(__dirname, "mcp", "exegol-mcp-shim-bin.js");
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
          EXEGOL_MCP_TOKEN: token,
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
          EXEGOL_MCP_TOKEN: token,
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
          EXEGOL_MCP_TOKEN: token,
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
          EXEGOL_MCP_TOKEN: token,
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
        return;
      case "devin":
        writeDevinConfig(cwd, shimPath, token, accessMode);
        return;
      case "gemini":
        writeGeminiConfig(cwd, shimPath, token, accessMode);
        return;
      case "codex-global":
        ensureCodexGlobalConfig(shimPath);
        // codex launches MCP servers with a SANITIZED env (verified live
        // 2026-08-12: shim got no EXEGOL_MCP_TOKEN → read-mode tools). The
        // token must live on disk: codex ignores .mcp.json but the shim
        // reads it from its cwd as a fallback — and reattach token re-arm
        // works for codex again via readAgentMcpToken.
        writeAgentMcpConfig(cwd, shimPath, token, accessMode);
        return;
      default:
        writeAgentMcpConfig(cwd, shimPath, token, accessMode);
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
  const fromMcpJson = readMcpJson(join(cwd, ".mcp.json"))?.mcpServers?.[EXEGOL_SERVER_KEY] as
    | { env?: Record<string, unknown> }
    | undefined;
  const t1 = fromMcpJson?.env?.EXEGOL_MCP_TOKEN;
  if (typeof t1 === "string" && t1.length > 0) return t1;

  const opencode = (
    readMcpJson(join(cwd, "opencode.json")) as { mcp?: Record<string, unknown> } | null
  )?.mcp?.[EXEGOL_SERVER_KEY] as { environment?: Record<string, unknown> } | undefined;
  const t2 = opencode?.environment?.EXEGOL_MCP_TOKEN;
  if (typeof t2 === "string" && t2.length > 0) return t2;

  const gemini = readMcpJson(join(cwd, ".gemini", "settings.json"))?.mcpServers?.[
    EXEGOL_SERVER_KEY
  ] as { env?: Record<string, unknown> } | undefined;
  const t3 = gemini?.env?.EXEGOL_MCP_TOKEN;
  if (typeof t3 === "string" && t3.length > 0) return t3;

  const devin = readMcpJson(join(cwd, ".devin", "mcp_config.local.json"))?.mcpServers?.[
    EXEGOL_SERVER_KEY
  ] as { env?: Record<string, unknown> } | undefined;
  const t4 = devin?.env?.EXEGOL_MCP_TOKEN;
  return typeof t4 === "string" && t4.length > 0 ? t4 : null;
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
