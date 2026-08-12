import type { Socket } from "node:net";
import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import type { JsonRpcResponse } from "./exegol-protocol";
import {
  handleRequest,
  registerAgentMcpToken,
  restoreAgentMcpToken,
  revokeAgentMcpToken,
} from "./exegol-server";

function fakeSocket(): { socket: Socket; responses: JsonRpcResponse[] } {
  const responses: JsonRpcResponse[] = [];
  const socket = {
    write: (data: string) => {
      responses.push(JSON.parse(data) as JsonRpcResponse);
      return true;
    },
  } as unknown as Socket;
  return { socket, responses };
}

async function call(
  db: Database.Database,
  params: { tool: string; args: Record<string, unknown>; token?: string },
  method = "call_tool",
): Promise<JsonRpcResponse> {
  const { socket, responses } = fakeSocket();
  await handleRequest(db, socket, { jsonrpc: "2.0", id: 1, method, params });
  expect(responses).toHaveLength(1);
  const res = responses[0];
  if (!res) throw new Error("no response written");
  return res;
}

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'proj', '/tmp/p1')").run();
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, access_mode)
     VALUES ('writer', 'p1', 'claude-code', 'running', 't', 'write'),
            ('reader', 'p1', 'claude-code', 'running', 't', 'read')`,
  ).run();
  return db;
}

describe("exegol MCP server token lifecycle", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    revokeAgentMcpToken("writer");
    revokeAgentMcpToken("reader");
  });

  it("rejects unknown methods with -32601", async () => {
    const res = await call(db, { tool: "memory_list", args: {} }, "list_tools_nope");
    expect(res.error?.code).toBe(-32601);
  });

  it("rejects a call with no token with -32002", async () => {
    const res = await call(db, { tool: "memory_list", args: {} });
    expect(res.error?.code).toBe(-32002);
    expect(res.result).toBeUndefined();
  });

  it("rejects an unknown token with -32002", async () => {
    const res = await call(db, { tool: "memory_list", args: {}, token: "deadbeef" });
    expect(res.error?.code).toBe(-32002);
  });

  it("accepts a call carrying a freshly minted token", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    const res = await call(db, { tool: "memory_list", args: {}, token });
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ total: 0, facts: [] });
  });

  it("mints one stable token per agent", () => {
    const a = registerAgentMcpToken("writer", "p1");
    const b = registerAgentMcpToken("writer", "p1");
    expect(a).toBe(b);
    expect(registerAgentMcpToken("reader", "p1")).not.toBe(a);
  });

  it("rejects a revoked token with -32002", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    revokeAgentMcpToken("writer");
    const res = await call(db, { tool: "memory_list", args: {}, token });
    expect(res.error?.code).toBe(-32002);
  });

  it("re-arms a restored token after restart", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    revokeAgentMcpToken("writer");
    restoreAgentMcpToken("writer", "p1", token);
    const res = await call(db, { tool: "memory_list", args: {}, token });
    expect(res.error).toBeUndefined();
  });

  it("allows memory_save for an agent the DB marks as write", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    const res = await call(db, {
      tool: "memory_save",
      args: { fact: "uses bun as package manager", category: "convention" },
      token,
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toHaveProperty("id");
    const row = db.prepare("SELECT content, source_agent_id FROM memories").get() as {
      content: string;
      source_agent_id: string;
    };
    expect(row.content).toBe("uses bun as package manager");
    expect(row.source_agent_id).toBe("writer");
  });

  it("denies memory_save for an agent the DB marks as read, with -32001", async () => {
    const token = registerAgentMcpToken("reader", "p1");
    const res = await call(db, {
      tool: "memory_save",
      args: { fact: "should never land", category: "convention" },
      token,
    });
    expect(res.error?.code).toBe(-32001);
    expect(res.error?.message).toContain("read");
    const count = db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("derives access mode from the DB, not from the client or mint-time state", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    db.prepare("UPDATE agents SET access_mode = 'read' WHERE id = 'writer'").run();
    const res = await call(db, {
      tool: "memory_save",
      args: { fact: "demoted mid-session", category: "convention" },
      token,
    });
    expect(res.error?.code).toBe(-32001);
  });

  it("rejects a token whose agent row is gone (leaked/stale secret is inert)", async () => {
    const token = registerAgentMcpToken("ghost", "p1");
    const res = await call(db, {
      tool: "memory_save",
      args: { fact: "no row", category: "convention" },
      token,
    });
    expect(res.error?.code).toBe(-32002);
    revokeAgentMcpToken("ghost");
  });

  it("still allows read-only tools for a read-mode agent", async () => {
    const token = registerAgentMcpToken("reader", "p1");
    const res = await call(db, { tool: "memory_list", args: {}, token });
    expect(res.error).toBeUndefined();
  });

  it("maps unknown tools to -32601", async () => {
    const token = registerAgentMcpToken("writer", "p1");
    const res = await call(db, { tool: "rm_rf", args: {}, token });
    expect(res.error?.code).toBe(-32601);
  });
});
