/**
 * MCP Host — connects to MCP servers, discovers tools, proxies requests.
 * Inspired by QMD's MCP server, Zed's ContextServerRegistry, Nanobot's MCP client.
 *
 * Uses @modelcontextprotocol/sdk for stdio transport.
 * HTTP transport uses a simple fetch-based approach.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { TransientError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { McpServerConfig, McpServerState, McpTool } from "./registry";

// ─── JSON-RPC types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Stdio transport ─────────────────────────────────────────────────────────

// Cap on the un-framed stdout accumulator. A server that streams data without
// a parseable Content-Length frame would otherwise grow this without bound.
const MAX_STDIO_BUFFER_BYTES = 16 * 1024 * 1024;

class StdioTransport {
  private process: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  /** Called when the process exits unexpectedly */
  onDisconnect: (() => void) | null = null;

  constructor(
    private command: string,
    private args: string[],
  ) {}

  async start(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
      if (this.buffer.length > MAX_STDIO_BUFFER_BYTES) {
        logger.error(
          `[MCP] stdout buffer exceeded ${MAX_STDIO_BUFFER_BYTES} bytes without a parseable frame — dropping buffer`,
        );
        this.buffer = "";
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.warn("[MCP] stderr:", data.toString().trim());
    });

    this.process.on("error", (err) => {
      logger.error("[MCP] Process error:", err);
      for (const pending of this.pendingRequests.values()) {
        pending.reject(err);
      }
      this.pendingRequests.clear();
    });

    this.process.on("exit", (code) => {
      logger.info("[MCP] Process exited:", code);
      const err = new TransientError(`MCP server exited with code ${code}`, "MCP_DISCONNECT");
      for (const pending of this.pendingRequests.values()) {
        pending.reject(err);
      }
      this.pendingRequests.clear();
      this.onDisconnect?.();
    });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error("MCP transport not started");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const msg = JSON.stringify(request);
      this.process?.stdin?.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
    });
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = Number.parseInt(lengthMatch[1] ?? "0", 10);
      const contentStart = headerEnd + 4;
      if (this.buffer.length < contentStart + contentLength) break;

      const content = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);

      try {
        const response = JSON.parse(content) as JsonRpcResponse;
        if (response.id !== undefined) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch (err) {
        logger.warn("[MCP] Failed to parse response:", err);
      }
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.pendingRequests.clear();
  }
}

// ─── HTTP transport ──────────────────────────────────────────────────────────

class HttpTransport {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {}

  async start(): Promise<void> {
    // HTTP transport doesn't need an explicit start — session is created on first request
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.headers,
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await fetch(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(request),
      // Match the stdio transport's 30s per-request timeout — a hung HTTP
      // server would otherwise block callTool forever.
      signal: AbortSignal.timeout(30_000),
    });

    // Capture session ID from response
    const sid = response.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    if (!response.ok) {
      throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as JsonRpcResponse;
    if (json.error) {
      throw new Error(json.error.message);
    }
    return json.result;
  }

  stop(): void {
    this.sessionId = null;
  }
}

// ─── MCP Host singleton ─────────────────────────────────────────────────────

type Transport = StdioTransport | HttpTransport;

let instance: McpHost | null = null;

export function getMcpHost(): McpHost {
  if (!instance) {
    instance = new McpHost();
  }
  return instance;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 2_000;

export class McpHost {
  private servers = new Map<string, { transport: Transport; state: McpServerState }>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();

  /**
   * Connect to an MCP server and discover its tools.
   */
  async connect(config: McpServerConfig): Promise<McpServerState> {
    // Disconnect existing connection if any
    this.disconnect(config.id);

    const state: McpServerState = {
      config,
      status: "connecting",
      tools: [],
    };

    let transport: Transport;
    if (config.transport === "stdio") {
      if (!config.command) {
        state.status = "error";
        state.error = "No command specified for stdio transport";
        return state;
      }
      const stdioTransport = new StdioTransport(config.command, config.args ?? []);
      stdioTransport.onDisconnect = () => this.scheduleReconnect(config);
      transport = stdioTransport;
    } else {
      if (!config.url) {
        state.status = "error";
        state.error = "No URL specified for HTTP transport";
        return state;
      }
      transport = new HttpTransport(config.url, config.headers ?? {});
    }

    this.servers.set(config.id, { transport, state });

    try {
      await transport.start();

      // Initialize the MCP session
      await transport.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "exegol", version: "1.0.0" },
      });

      // Discover tools
      const toolsResult = (await transport.request("tools/list")) as {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };

      state.tools = (toolsResult?.tools ?? []).map((t) => ({
        serverId: config.id,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? {},
      }));

      state.status = "connected";
      this.reconnectAttempts.delete(config.id);
      logger.info(`[MCP] Connected to ${config.name}, discovered ${state.tools.length} tools`);
    } catch (err) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
      logger.error(`[MCP] Failed to connect to ${config.name}:`, err);
    }

    return state;
  }

  /**
   * Schedule auto-reconnect with exponential backoff.
   */
  private scheduleReconnect(config: McpServerConfig): void {
    // Prevent overlapping reconnect timers
    const existingTimer = this.reconnectTimers.get(config.id);
    if (existingTimer) return;

    const attempt = (this.reconnectAttempts.get(config.id) ?? 0) + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      logger.warn(`[MCP] Max reconnect attempts reached for ${config.name}, giving up`);
      const entry = this.servers.get(config.id);
      if (entry) entry.state.status = "error";
      return;
    }

    this.reconnectAttempts.set(config.id, attempt);
    const delay = INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1);
    logger.info(
      `[MCP] Reconnecting to ${config.name} in ${delay}ms (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})`,
    );

    const entry = this.servers.get(config.id);
    if (entry) entry.state.status = "connecting";

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(config.id);
      this.connect(config).catch(() => {});
    }, delay);
    this.reconnectTimers.set(config.id, timer);
  }

  /**
   * Disconnect from an MCP server.
   */
  disconnect(serverId: string): void {
    // Cancel any pending reconnect
    const timer = this.reconnectTimers.get(serverId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(serverId);
    }
    this.reconnectAttempts.delete(serverId);

    const entry = this.servers.get(serverId);
    if (entry) {
      if (entry.transport instanceof StdioTransport) {
        entry.transport.onDisconnect = null;
      }
      entry.transport.stop();
      this.servers.delete(serverId);
      logger.info(`[MCP] Disconnected from ${entry.state.config.name}`);
    }
  }

  /**
   * Call a tool on a connected server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`MCP server ${serverId} not connected`);
    if (entry.state.status !== "connected") {
      throw new Error(`MCP server ${serverId} is ${entry.state.status}`);
    }

    return entry.transport.request("tools/call", { name: toolName, arguments: args });
  }

  /**
   * Get the state of all connected servers.
   */
  listServers(): McpServerState[] {
    return Array.from(this.servers.values()).map((e) => e.state);
  }

  /**
   * Get all tools from all connected servers.
   */
  listAllTools(): McpTool[] {
    return Array.from(this.servers.values()).flatMap((e) => e.state.tools);
  }

  /**
   * Build a context string describing available MCP tools for agent prompt injection.
   * Inspired by QMD's dynamic instructions pattern.
   */
  buildToolContext(): string {
    const tools = this.listAllTools();
    if (tools.length === 0) return "";

    const lines = tools.map((t) => `- **${t.name}** (${t.serverId}): ${t.description}`);
    return `# Available MCP Tools\n\n${lines.join("\n")}\n`;
  }

  /**
   * Disconnect all servers.
   */
  disconnectAll(): void {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    for (const [id] of this.servers) {
      this.disconnect(id);
    }
  }
}
