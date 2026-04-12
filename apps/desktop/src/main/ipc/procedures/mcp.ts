import { mcpServerConfigSchema } from "@exegol/shared";
import { z } from "zod";
import { getMcpHost } from "../../mcp/host";
import type { McpServerConfig, McpServerState, McpTool } from "../../mcp/registry";
import { publicProcedure, router } from "../trpc";

export const mcpRouter = router({
  /**
   * List all MCP server states (connected + tools discovered).
   */
  listServers: publicProcedure.query((): McpServerState[] => {
    return getMcpHost().listServers();
  }),

  /**
   * Connect to an MCP server.
   */
  connect: publicProcedure
    .input(mcpServerConfigSchema)
    .mutation(async ({ input }): Promise<McpServerState> => {
      return getMcpHost().connect(input as McpServerConfig);
    }),

  /**
   * Disconnect from an MCP server.
   */
  disconnect: publicProcedure.input(z.object({ serverId: z.string() })).mutation(({ input }) => {
    getMcpHost().disconnect(input.serverId);
    return { success: true };
  }),

  /**
   * List all tools from all connected servers.
   */
  listTools: publicProcedure.query((): McpTool[] => {
    return getMcpHost().listAllTools();
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
    .mutation(async ({ input }) => {
      return getMcpHost().callTool(input.serverId, input.toolName, input.args);
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
