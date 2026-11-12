/**
 * Unix-socket JSON-RPC endpoint in the main process for the stdio shims. Identity comes from a
 * per-agent token minted at spawn (exegol-tokens.ts, exegol-identity.ts); access mode is re-read
 * from the DB on every call, nothing the client claims is trusted.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { McpAgentState, McpSessionInfo } from "@exegol/shared";
import type Database from "libsql";
import { forgetBrowserAgent } from "../browser/agent-browser-tools";
import { COMMANDER_LINE } from "../commander/brief";
import { isCommander } from "../commander/home";
import { listLiveAgentClis, listLiveAgentSessions } from "../db/queries/agents";
import { findBlockingClaim } from "../db/queries/path-claims";
import { getProject } from "../db/queries/projects";
import { sessionLine } from "../inbox/session-line";
import { isNamedPipe } from "../lib/ipc-endpoint";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { realpathSafeSync } from "../security/path-guard";
import { record } from "./exegol-activity";
import { primeAncestors, resolveContext } from "./exegol-identity";
import { readsExegolMcpConfig } from "./exegol-mcp-config";
import {
  createFrameReader,
  EXEGOL_DIR,
  type ExegolToolCallParams,
  encodeResponse,
  type JsonRpcRequest,
  MCP_SOCK_PATH,
} from "./exegol-protocol";
import {
  activeTokenCount,
  boundAgents,
  clearTokens,
  connectedAgentIds,
  hasToken,
  type McpConnectionState,
  markConnected,
  markDisconnected,
  revokeToken,
} from "./exegol-tokens";
import { getToolDefsForAccessMode } from "./exegol-tool-defs";
import { callExegolTool, ExegolToolError } from "./exegol-tools";

export { getRecentMcpActivity, setMcpVerboseLogging } from "./exegol-activity";
export {
  type McpConnectionState,
  registerAgentMcpToken,
  restoreAgentMcpToken,
  setMcpStatusListener,
} from "./exegol-tokens";

let server: Server | null = null;
let connectionSeq = 0;

export function revokeAgentMcpToken(agentId: string): void {
  revokeToken(agentId);
  // Its browser waits and "needs you" alerts die with it
  forgetBrowserAgent(agentId);
}

/** Per live agent: a shim is connected with its token, it has a token but no shim yet, or Exegol
 *  never wired MCP for it (shells, or a spawn without a config) */
function bridgeState(id: string, cliType: string, connected: Set<string>): McpAgentState {
  if (connected.has(id)) return "connected";
  return hasToken(id) && readsExegolMcpConfig(cliType) ? "not_connected" : "not_wired";
}

export function getMcpAgentStates(db: Database.Database): Record<string, McpAgentState> {
  const connected = connectedAgentIds();
  const out: Record<string, McpAgentState> = {};
  for (const a of listLiveAgentClis(db)) out[a.id] = bridgeState(a.id, a.cliType, connected);
  return out;
}

/** Settings > MCP Server: every live agent session with its bridge state */
export function getMcpSessions(db: Database.Database): McpSessionInfo[] {
  const connected = connectedAgentIds();
  return listLiveAgentSessions(db).map((a) => ({
    ...a,
    state: bridgeState(a.id, a.cliType, connected),
  }));
}

export async function handleRequest(
  db: Database.Database,
  socket: Socket,
  req: JsonRpcRequest,
  conn?: McpConnectionState,
): Promise<void> {
  const caller = req.params as { token?: string; ppid?: number } | undefined;
  // A bridge says who it is as soon as it connects. No process walk: every bridge does this at
  // once when the app starts; a token shared by several sessions waits for its first call.
  if (req.method === "hello") {
    const bound = caller?.token ? boundAgents(caller.token) : undefined;
    const agentId = bound?.length === 1 ? bound[0]?.agentId : undefined;
    if (agentId) markConnected(conn, agentId);
    record({ kind: "connect", agentId, detail: `shim #${conn?.id ?? "?"}` });
    if (!agentId) {
      const why = bound?.length ? "token shared by several sessions" : "no valid token";
      record({ kind: "error", tool: "hello", detail: `${why}: known on its first call` });
    }
    socket.write(encodeResponse(req.id, {}));
    return;
  }
  await primeAncestors(conn, caller?.token, caller?.ppid);
  // Shims proxy tools/list so a shim spawned weeks ago lists what the running app has
  if (req.method === "list_tools") {
    const resolved = resolveContext(db, caller?.token, caller?.ppid, conn);
    record({
      kind: "call",
      tool: "tools/list",
      agentId: resolved.ok ? resolved.context.agentId : undefined,
      detail: resolved.ok ? undefined : "no valid identity (listing read-mode tools)",
    });
    if (resolved.ok) markConnected(conn, resolved.context.agentId);
    socket.write(
      encodeResponse(req.id, {
        tools: getToolDefsForAccessMode(
          resolved.ok ? resolved.context.accessMode : "read",
          resolved.ok && !!getProject(db, resolved.context.projectId)?.browserEval,
          resolved.ok && isCommander(db, resolved.context),
        ),
      }),
    );
    return;
  }
  if (req.method === "session_context") {
    const resolved = resolveContext(db, caller?.token, caller?.ppid, conn);
    const text = !resolved.ok
      ? ""
      : isCommander(db, resolved.context)
        ? COMMANDER_LINE
        : await sessionLine(db, resolved.context.projectId);
    socket.write(encodeResponse(req.id, { text }));
    return;
  }
  // Claim enforcement before the write (git cannot attribute a change in a shared tree). Identity
  // comes from the same token as the shim, so an agent cannot ask on someone's behalf.
  if (req.method === "check_path") {
    const params = req.params as { token?: string; ppid?: number; path?: string };
    const resolved = resolveContext(db, params.token, params.ppid, conn);
    if (!resolved.ok || !params.path) {
      // Fail open, but counted: a silent allow looks like a session that never needed enforcement
      record({
        kind: "error",
        tool: "check_path",
        detail: resolved.ok ? "no path in request — allowed" : "unidentified caller — allowed",
      });
      socket.write(encodeResponse(req.id, { allowed: true }));
      return;
    }
    const { agentId, projectId } = resolved.context;
    let holder: { heldBy: string; note: string | null } | null = null;
    try {
      // Claims are stored through realpath: both sides must spell a symlinked path the same way
      holder = findBlockingClaim(db, {
        agentId,
        projectId,
        path: realpathSafeSync(params.path),
      });
    } catch (err) {
      record({
        kind: "error",
        tool: "check_path",
        agentId,
        detail: "claim lookup failed — allowed",
      });
      logger.warn("[ExegolMcp] check_path failed (allowing):", err);
    }
    // Only blocks are recorded: a hundred edits would evict everything else from the ring
    if (holder) {
      record({
        kind: "error",
        tool: "check_path",
        agentId,
        detail: `blocked ${params.path} — held by ${holder.heldBy}`,
      });
      try {
        getNotificationBus().emit({
          type: "agent:attention",
          title: "Write blocked — file claimed by another agent",
          body: `${params.path} is held by "${holder.heldBy}"`,
          agentId,
          projectId,
          at: Date.now(),
        });
      } catch {
        /* notifications are best-effort */
      }
    }
    socket.write(encodeResponse(req.id, { allowed: !holder, ...holder }));
    return;
  }

  if (req.method !== "call_tool") {
    record({ kind: "error", detail: `unknown method: ${req.method}` });
    socket.write(
      encodeResponse(req.id, undefined, { code: -32601, message: `Unknown method: ${req.method}` }),
    );
    return;
  }

  const params = req.params as ExegolToolCallParams;
  const resolved = resolveContext(db, params.token, params.ppid, conn);
  if (!resolved.ok) {
    record({ kind: "error", tool: params.tool, detail: resolved.message });
    socket.write(
      encodeResponse(req.id, undefined, { code: resolved.code, message: resolved.message }),
    );
    return;
  }
  const context = resolved.context;
  markConnected(conn, context.agentId);

  const startedAt = Date.now();
  try {
    const result = await callExegolTool(db, params.tool, params.args ?? {}, context);
    record({
      kind: "call",
      tool: params.tool,
      agentId: context.agentId,
      ms: Date.now() - startedAt,
    });
    socket.write(encodeResponse(req.id, result));
  } catch (err) {
    const code = err instanceof ExegolToolError ? err.code : -32000;
    const message = err instanceof Error ? err.message : String(err);
    record({
      kind: "error",
      tool: params.tool,
      agentId: context.agentId,
      ms: Date.now() - startedAt,
      detail: `${code}: ${message}`,
    });
    socket.write(encodeResponse(req.id, undefined, { code, message }));
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function startListening(db: Database.Database): void {
  const srv = createServer((socket: Socket) => {
    const connId = ++connectionSeq;
    const conn: McpConnectionState = { id: connId };
    // Announced lazily: the claim guard opens a connection per write
    let announced = false;
    const feed = createFrameReader<JsonRpcRequest>(
      (msg) => {
        if (!announced && msg.method !== "check_path") {
          announced = true;
          // A bridge from before `hello`: its first request is all that announces it
          if (msg.method !== "hello") record({ kind: "connect", detail: `shim #${connId}` });
        }
        handleRequest(db, socket, msg, conn).catch((err) => {
          record({
            kind: "error",
            detail: `unhandled: ${err instanceof Error ? err.message : err}`,
          });
          logger.warn("[ExegolMcp] Unhandled request error:", err);
        });
      },
      () => {
        record({ kind: "error", detail: `shim #${connId} exceeded the frame limit` });
        logger.warn(`[ExegolMcp] shim #${connId} sent an oversized frame — discarding`);
      },
    );
    socket.on("data", feed);
    socket.on("close", () => {
      markDisconnected(connId);
      if (announced) record({ kind: "disconnect", detail: `shim #${connId}` });
    });
    socket.on("error", () => {
      /* client disconnects are routine — nothing to clean up per-connection */
    });
  });

  srv.on("error", (err) => {
    // A named pipe in use is another live instance's (the probe below is for socket files)
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && isNamedPipe(MCP_SOCK_PATH)) {
      logger.warn(
        "[ExegolMcp] Another live instance owns the MCP pipe, not starting a second server",
      );
    } else {
      logger.warn("[ExegolMcp] Server error:", err);
    }
    server = null; // allow a later ensure() to retry
  });

  srv.listen(MCP_SOCK_PATH, () => {
    if (isNamedPipe(MCP_SOCK_PATH)) {
      // Per-user name, default DACL (owner, SYSTEM, admins); the per-agent token still gates calls
      logger.info("[ExegolMcp] Listening on a named pipe");
      return;
    }
    try {
      chmodSync(MCP_SOCK_PATH, 0o600);
    } catch (err) {
      logger.warn("[ExegolMcp] Failed to chmod socket:", err);
    }
    logger.info(`[ExegolMcp] Listening on ${MCP_SOCK_PATH}`);
  });

  server = srv;
}

/** Start the socket server if not already running. Safe to call repeatedly. */
export function ensureExegolMcpServerStarted(db: Database.Database): void {
  if (server) return;

  mkdirSync(EXEGOL_DIR, { recursive: true, mode: 0o700 });

  if (isNamedPipe(MCP_SOCK_PATH) || !existsSync(MCP_SOCK_PATH)) {
    startListening(db);
    return;
  }

  // Probe before unlinking: a second instance must not take over a live socket
  const probe = connect(MCP_SOCK_PATH);
  const settle = (stale: boolean) => {
    probe.destroy();
    if (!stale) {
      logger.warn(
        "[ExegolMcp] Another live instance owns the MCP socket — not starting a second server",
      );
      return;
    }
    try {
      unlinkSync(MCP_SOCK_PATH);
    } catch (err) {
      logger.warn("[ExegolMcp] Failed to clear stale socket:", err);
    }
    startListening(db);
  };
  probe.once("connect", () => settle(false));
  probe.once("error", () => settle(true));
}

/** T162 settings surface: live server state + how many tokens are armed. */
export function getExegolMcpServerInfo(): {
  running: boolean;
  sockPath: string;
  activeTokens: number;
  connected: number;
} {
  return {
    running: server !== null,
    sockPath: MCP_SOCK_PATH,
    activeTokens: activeTokenCount(),
    connected: connectedAgentIds().size,
  };
}

export function stopExegolMcpServer(): void {
  // Another instance (dev beside packaged) may own the socket; only the owner unlinks it
  const owned = server?.listening === true;
  server?.close();
  server = null;
  clearTokens();
  try {
    if (owned && !isNamedPipe(MCP_SOCK_PATH) && existsSync(MCP_SOCK_PATH)) {
      unlinkSync(MCP_SOCK_PATH);
    }
  } catch {
    /* best-effort */
  }
}
