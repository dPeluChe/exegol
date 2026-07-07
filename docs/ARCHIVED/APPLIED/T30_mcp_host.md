# T30 — MCP Host (Tool Proxy)

## Inspiration Source
- **Repo**: QMD (`github.com/tobi/qmd`)
- **Files studied**: `src/mcp/server.ts`, `src/mcp/instructions.ts`
- **Pattern applied**: JSON-RPC over stdio with Content-Length framing, tool registration with Zod schemas, dynamic instructions from available tools

- **Repo**: Zed (`github.com/zed-industries/zed`)
- **Files studied**: `crates/agent/src/tools/context_server_registry.rs`, `crates/context_server/src/transport/http.rs`, `crates/context_server/src/context_server.rs`
- **Pattern applied**: Tool discovery via `tools/list`, tool ID formatting as `server:tool`, session management for HTTP transport

- **Repo**: Nanobot (`github.com/HKUDS/nanobot`)
- **Files studied**: `nanobot/agent/tools/mcp.py`
- **Pattern applied**: Transport selection (stdio vs HTTP), tool wrapper with timeout, server initialization flow

## What Changed
- `apps/desktop/src/main/mcp/registry.ts` — NEW: Types for MCP server config, tools, state
- `apps/desktop/src/main/mcp/host.ts` — NEW: MCP Host with stdio and HTTP transports, JSON-RPC protocol, tool discovery
- `apps/desktop/src/main/ipc/procedures/mcp.ts` — NEW: tRPC router for MCP operations
- `apps/desktop/src/main/ipc/router.ts` — Registered mcp router
- `apps/desktop/src/main/agents/manager.ts` — MCP tool context injection on spawn
- `apps/desktop/src/main/index.ts` — MCP host cleanup on shutdown
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Added MCP hooks (useMcpServers, useMcpConfigs, etc.)

## Architecture Decisions
- **Custom JSON-RPC implementation** — Instead of depending on `@modelcontextprotocol/sdk` (which adds significant weight), implemented minimal JSON-RPC 2.0 over stdio (Content-Length framing) and HTTP. The MCP protocol is simple enough that a ~300 line implementation covers our needs.
- **Dual transport** — Stdio for local tools (most common), HTTP for remote MCP servers. Stdio uses child_process.spawn with piped stdio. HTTP uses fetch with session ID tracking.
- **Settings-backed config** — MCP server configs stored in the settings table as JSON. No new migration needed since we reuse the existing settings key-value store.
- **Dynamic instructions pattern** — `buildToolContext()` generates a markdown description of all available tools from connected servers. This gets injected into agent prompts alongside skill context.
- **Singleton host** — Single McpHost instance manages all server connections. Cleaned up on app shutdown.

## How to Test
1. Configure an MCP server via tRPC: `mcp.saveConfigs([{ id: "test", name: "Test", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"], enabled: true }])`
2. Connect: `mcp.connect(config)` — should return state with discovered tools
3. List tools: `mcp.listTools()` — should show tools from connected server
4. Call tool: `mcp.callTool({ serverId, toolName, args })` — should return tool result
5. Spawn an agent — MCP tool context should appear in the agent prompt prefix
6. Disconnect: `mcp.disconnect(serverId)` — should clean up
