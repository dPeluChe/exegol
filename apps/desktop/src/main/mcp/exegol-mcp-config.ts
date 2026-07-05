/**
 * T145 — Writes the "exegol" entry into a spawned agent's `.mcp.json`
 * (the widely-adopted MCP client config convention — Claude Code, Cursor,
 * Windsurf all discover it in the CWD). Upserts only the "exegol" key,
 * exactly like T140's managed-block pattern: never touches other servers
 * the user has configured.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";
import type { ExegolAccessMode } from "./exegol-protocol";

const EXEGOL_SERVER_KEY = "exegol";

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

function readMcpJson(path: string): McpJsonFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as McpJsonFile;
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to parse existing .mcp.json, starting fresh:", err);
    return {};
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
    writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to write .mcp.json:", err);
  }
}

/** Best-effort removal of the exegol entry on agent exit — the token is
 *  revoked anyway, but a dead entry pollutes the repo if committed. */
export function removeAgentMcpConfig(cwd: string): void {
  const configPath = join(cwd, ".mcp.json");
  if (!existsSync(configPath)) return;
  try {
    const existing = readMcpJson(configPath);
    const servers = existing.mcpServers;
    if (!servers || !(EXEGOL_SERVER_KEY in servers)) return;
    const { [EXEGOL_SERVER_KEY]: _removed, ...rest } = servers;
    if (Object.keys(rest).length === 0 && Object.keys(existing).length === 1) {
      unlinkSync(configPath);
      return;
    }
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...existing, mcpServers: rest }, null, 2)}\n`,
      "utf-8",
    );
  } catch (err) {
    logger.warn("[ExegolMcp] Failed to clean .mcp.json:", err);
  }
}
