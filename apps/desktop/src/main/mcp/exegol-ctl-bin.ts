/**
 * T145 — exegol-ctl: CLI shim fallback for agent CLIs that don't speak MCP.
 * Connects to the same Unix socket as the MCP shim and makes a single
 * `call_tool` round-trip, printing the JSON result to stdout.
 *
 * Usage:
 *   exegol-ctl mem search <query> [category]
 *   exegol-ctl mem add <category> <fact...>
 *   exegol-ctl knowledge get [section]
 *
 * Reads EXEGOL_AGENT_ID / EXEGOL_PROJECT_ID / EXEGOL_ACCESS_MODE from env,
 * same attribution/gating as the MCP shim — documented in the managed
 * AGENTS.md/CLAUDE.md block (T140) so non-MCP CLIs can shell out to it.
 */

import { connect } from "node:net";
import { createNdjsonBuffer, encodeRequest, type ExegolAccessMode, type JsonRpcResponse, MCP_SOCK_PATH } from "./exegol-protocol";

const accessMode = (process.env.EXEGOL_ACCESS_MODE as ExegolAccessMode) ?? "write";
const agentId = process.env.EXEGOL_AGENT_ID ?? "";
const projectId = process.env.EXEGOL_PROJECT_ID ?? "";

function usageError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { tool: string; args: Record<string, unknown> } {
  const [group, action, ...rest] = argv;

  if (group === "mem" && action === "search") {
    const [query, category] = rest;
    if (!query) usageError("Usage: exegol-ctl mem search <query> [category]");
    return { tool: "memory_search", args: category ? { query, category } : { query } };
  }

  if (group === "mem" && action === "add") {
    const [category, ...factParts] = rest;
    const fact = factParts.join(" ");
    if (!category || !fact) usageError("Usage: exegol-ctl mem add <category> <fact...>");
    return { tool: "memory_save", args: { category, fact } };
  }

  if (group === "knowledge" && action === "get") {
    const [section] = rest;
    return { tool: "knowledge_get", args: section ? { section } : {} };
  }

  usageError(
    "Usage:\n  exegol-ctl mem search <query> [category]\n  exegol-ctl mem add <category> <fact...>\n  exegol-ctl knowledge get [section]",
  );
}

const { tool, args } = parseArgs(process.argv.slice(2));

const socket = connect(MCP_SOCK_PATH);
socket.on("connect", () => {
  socket.write(encodeRequest(1, "call_tool", { tool, args, context: { agentId, accessMode, projectId } }));
});

socket.on(
  "data",
  createNdjsonBuffer<JsonRpcResponse>((res) => {
    if (res.error) {
      process.stderr.write(`${res.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(res.result, null, 2)}\n`);
    }
    socket.end();
  }),
);

socket.on("error", (err) => {
  process.stderr.write(`Could not reach the Exegol MCP server: ${err.message}\n`);
  process.exitCode = 1;
});
