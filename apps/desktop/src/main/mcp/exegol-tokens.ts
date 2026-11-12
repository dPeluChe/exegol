import { randomBytes } from "node:crypto";

/** One socket connection: a CLI runs one shim, so who is on it holds for its whole life */
export interface McpConnectionState {
  /** Socket connection number, for the connected-agents view */
  id?: number;
  pinnedAgentId?: string;
  /** Cached `ps` walk: the shim's ancestry is fixed for the connection */
  ancestors?: number[];
}

export interface TokenEntry {
  agentId: string;
  projectId: string;
}

// A token may bind several agents: per-directory MCP configs (opencode, gemini, devin, agy) share
// one secret across sessions in a repo; exegol-identity.ts tells them apart or refuses to guess.
const tokensBySecret = new Map<string, TokenEntry[]>();
const tokensByAgent = new Map<string, string>();

function bindToken(token: string, entry: TokenEntry): void {
  // A rebind must release the old secret, or it keeps resolving this agent
  const previous = tokensByAgent.get(entry.agentId);
  if (previous && previous !== token) {
    const rest = (tokensBySecret.get(previous) ?? []).filter((e) => e.agentId !== entry.agentId);
    if (rest.length === 0) tokensBySecret.delete(previous);
    else tokensBySecret.set(previous, rest);
  }
  const entries = tokensBySecret.get(token) ?? [];
  if (!entries.some((e) => e.agentId === entry.agentId)) entries.push(entry);
  tokensBySecret.set(token, entries);
  tokensByAgent.set(entry.agentId, token);
}

/** Mint (or reuse) the MCP token for an agent at spawn time. */
export function registerAgentMcpToken(agentId: string, projectId: string): string {
  const existing = tokensByAgent.get(agentId);
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  bindToken(token, { agentId, projectId });
  notifyMcpStatus();
  return token;
}

/** After an app restart: the registry is in memory, the reattached shim still holds this secret */
export function restoreAgentMcpToken(agentId: string, projectId: string, token: string): void {
  bindToken(token, { agentId, projectId });
  notifyMcpStatus();
}

/** Revoke on agent exit — a leaked .mcp.json must not stay a live credential. */
export function revokeToken(agentId: string): void {
  const token = tokensByAgent.get(agentId);
  if (token) {
    // A shared token keeps working for the siblings still alive
    const rest = (tokensBySecret.get(token) ?? []).filter((e) => e.agentId !== agentId);
    if (rest.length === 0) tokensBySecret.delete(token);
    else tokensBySecret.set(token, rest);
  }
  tokensByAgent.delete(agentId);
  notifyMcpStatus();
}

/** connection id → the agent it authenticated as (list_tools or call_tool, never check_path) */
const connectedBy = new Map<number, string>();
let statusListener: (() => void) | null = null;
let statusQueued = false;

export function setMcpStatusListener(fn: (() => void) | null): void {
  statusListener = fn;
}

/** Coalesced: a burst of connects at startup is one push */
function notifyMcpStatus(): void {
  if (!statusListener || statusQueued) return;
  statusQueued = true;
  queueMicrotask(() => {
    statusQueued = false;
    statusListener?.();
  });
}

export function markConnected(conn: McpConnectionState | undefined, agentId: string): void {
  if (conn?.id === undefined || connectedBy.get(conn.id) === agentId) return;
  connectedBy.set(conn.id, agentId);
  notifyMcpStatus();
}

export function markDisconnected(connId: number): void {
  if (connectedBy.delete(connId)) notifyMcpStatus();
}

export const connectedAgentIds = (): Set<string> => new Set(connectedBy.values());

export const agentOnConnection = (connId: number): string | undefined => connectedBy.get(connId);

export const hasToken = (agentId: string): boolean => tokensByAgent.has(agentId);

/** The live bindings of a secret; several when sessions share a per-directory config */
export const boundAgents = (token: string): TokenEntry[] | undefined => tokensBySecret.get(token);

export const activeTokenCount = (): number => tokensByAgent.size;

export function clearTokens(): void {
  tokensBySecret.clear();
  tokensByAgent.clear();
  connectedBy.clear();
}
