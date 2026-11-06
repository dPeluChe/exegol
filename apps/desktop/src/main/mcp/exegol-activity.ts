import { logger } from "../lib/logger";

// The ring is always on: capped, in memory, the only view of what agents do over the socket
// (Settings > MCP Server > Activity). Log lines are opt-in, or a chatty fleet drowns the app log.
type McpActivityKind = "connect" | "disconnect" | "call" | "error";

interface McpActivityEntry {
  at: number;
  kind: McpActivityKind;
  tool?: string;
  agentId?: string;
  ms?: number;
  detail?: string;
}

const MAX_ACTIVITY = 100;
const activity: McpActivityEntry[] = [];
let verboseLogging = false;

export function setMcpVerboseLogging(enabled: boolean): void {
  if (verboseLogging === enabled) return;
  verboseLogging = enabled;
  logger.info(`[ExegolMcp] Verbose logging ${enabled ? "ENABLED" : "disabled"}`);
}

export function record(entry: Omit<McpActivityEntry, "at">): void {
  activity.push({ ...entry, at: Date.now() });
  if (activity.length > MAX_ACTIVITY) activity.shift();
  if (!verboseLogging) return;
  const who = entry.agentId ? ` agent=${entry.agentId}` : "";
  const took = entry.ms !== undefined ? ` (${entry.ms}ms)` : "";
  const what = entry.tool ? ` ${entry.tool}` : "";
  const detail = entry.detail ? ` — ${entry.detail}` : "";
  const line = `[ExegolMcp] ${entry.kind}${what}${who}${took}${detail}`;
  if (entry.kind === "error") logger.warn(line);
  else logger.info(line);
}

export function getRecentMcpActivity(): McpActivityEntry[] {
  return [...activity].reverse();
}
