import { mcpServerConfigSchema } from "@exegol/shared";
import { z } from "zod";
import { EXEGOL_TOOL_DEFS } from "../../mcp/exegol-protocol";
import { getExegolMcpServerInfo } from "../../mcp/exegol-server";
import type { McpServerConfig, McpServerState, McpTool } from "../../mcp/registry";
import { publicProcedure, router } from "../trpc";

/** T163: where each provider's MCP wiring lands — the settings panel renders
 *  this so users can see (and debug) the injection per CLI. */
const EXEGOL_MCP_PROVIDER_WIRING = [
  {
    provider: "Claude Code",
    cliType: "claude-code",
    config: "<cwd>/.mcp.json",
    tokenVia: "config env",
    status: "wired",
  },
  {
    provider: "OpenCode",
    cliType: "opencode",
    config: "<cwd>/opencode.json (mcp.exegol)",
    tokenVia: "config environment",
    status: "wired",
  },
  {
    provider: "Gemini",
    cliType: "gemini",
    config: "<cwd>/.gemini/settings.json",
    tokenVia: "config env",
    status: "wired",
  },
  {
    provider: "Codex",
    cliType: "codex",
    config: "~/.codex/config.toml (managed block) + <cwd>/.mcp.json for the token",
    tokenVia: "on-disk fallback (codex sanitizes env)",
    status: "wired",
  },
  {
    provider: "Devin",
    cliType: "devin",
    config: "<cwd>/.devin/mcp_config.local.json",
    tokenVia: "config env",
    status: "wired",
  },
  {
    provider: "Antigravity",
    cliType: "agy",
    config: "plugin system (agy plugin install) — pending",
    tokenVia: "n/a",
    status: "receive-only",
  },
  {
    provider: "Other CLIs",
    cliType: "*",
    config: "<cwd>/.mcp.json (convention — works if the CLI reads it)",
    tokenVia: "config env",
    status: "best-effort",
  },
] as const;

export const mcpRouter = router({
  /** T162/T163: Exegol's own MCP server — status, tools and per-provider wiring. */
  exegolStatus: publicProcedure.query(() => {
    return {
      ...getExegolMcpServerInfo(),
      tools: EXEGOL_TOOL_DEFS.map((t) => ({ name: t.name, description: t.description })),
      providers: EXEGOL_MCP_PROVIDER_WIRING,
    };
  }),
  /**
   * List all MCP server states (connected + tools discovered).
   */
  listServers: publicProcedure.query(({ ctx }): McpServerState[] => {
    return ctx.mcpHost.listServers();
  }),

  /**
   * Connect to an MCP server.
   */
  connect: publicProcedure
    .input(mcpServerConfigSchema)
    .mutation(async ({ ctx, input }): Promise<McpServerState> => {
      return ctx.mcpHost.connect(input as McpServerConfig);
    }),

  /**
   * Disconnect from an MCP server.
   */
  disconnect: publicProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.mcpHost.disconnect(input.serverId);
      return { success: true };
    }),

  /**
   * List all tools from all connected servers.
   */
  listTools: publicProcedure.query(({ ctx }): McpTool[] => {
    return ctx.mcpHost.listAllTools();
  }),

  /**
   * Call a tool on a connected server.
   */
  callTool: publicProcedure
    .input(
      z.object({
        serverId: z.string(),
        toolName: z.string(),
        args: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.mcpHost.callTool(input.serverId, input.toolName, input.args);
    }),

  /**
   * Get MCP server configs from settings DB.
   */
  getConfigs: publicProcedure.query(({ ctx }): McpServerConfig[] => {
    const row = ctx.db.prepare("SELECT value FROM settings WHERE key = ?").get("mcp_servers") as
      | { value: string }
      | undefined;
    if (!row) return [];
    try {
      return JSON.parse(row.value) as McpServerConfig[];
    } catch {
      return [];
    }
  }),

  /**
   * Save MCP server configs to settings DB.
   */
  saveConfigs: publicProcedure.input(z.array(mcpServerConfigSchema)).mutation(({ ctx, input }) => {
    const value = JSON.stringify(input);
    ctx.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      )
      .run("mcp_servers", value, value);
    return { success: true };
  }),
});
