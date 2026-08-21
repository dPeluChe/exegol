import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import type { JsonRpcResponse } from "./exegol-protocol";
import {
  handleRequest,
  type McpConnectionState,
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
  params: { tool: string; args: Record<string, unknown>; token?: string; ppid?: number },
  method = "call_tool",
  conn?: McpConnectionState,
): Promise<JsonRpcResponse> {
  const { socket, responses } = fakeSocket();
  await handleRequest(db, socket, { jsonrpc: "2.0", id: 1, method, params }, conn);
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

  it("resolves identity by parent process when two agents share a config file", async () => {
    // opencode/gemini/devin write ONE config per directory, so a sibling
    // session's token can be the one on disk. The OS knows who the caller is.
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, pid, access_mode)
       VALUES ('twin', 'p1', 'opencode', 'running', 'second opencode', unixepoch(), 4242, 'write')`,
    ).run();
    const tokenOfSibling = registerAgentMcpToken("writer", "p1");

    const res = await call(db, {
      tool: "memory_save",
      args: { fact: "written by the twin", category: "convention" },
      token: tokenOfSibling,
      ppid: 4242,
    });

    expect(res.error).toBeUndefined();
    const row = db
      .prepare("SELECT source_agent_id FROM memories WHERE content = 'written by the twin'")
      .get() as { source_agent_id?: string } | undefined;
    expect(row?.source_agent_id).toBe("twin");
    revokeAgentMcpToken("writer");
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

// The identity bug that swapped two sessions mid-conversation: a shared config
// file binds one token to several agents, and resolving it per call let `self`
// flip between them ("self.name = paco … minutos después estaba invertido").
describe("identity is stable and never guessed", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    for (const id of ["writer", "reader", "twin"]) revokeAgentMcpToken(id);
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, pid, access_mode)
       VALUES ('twin', 'p1', 'opencode', 'running', 'second opencode', unixepoch(), 4242, 'write')`,
    ).run();
  });

  /** Two sessions in one directory read the same file, hence the same secret. */
  function shareOneToken(): string {
    const token = registerAgentMcpToken("writer", "p1");
    restoreAgentMcpToken("twin", "p1", token);
    return token;
  }

  it("refuses to pick an identity when a shared token is ambiguous", async () => {
    const res = await call(db, { tool: "agents_list", args: {}, token: shareOneToken() });
    expect(res.error?.code).toBe(-32003);
    expect(res.error?.message).toContain("Ambiguous identity");
  });

  it("pins the process-tree identity for the rest of the connection", async () => {
    const token = shareOneToken();
    const conn = {};

    const first = await call(
      db,
      { tool: "agents_list", args: {}, token, ppid: 4242 },
      "call_tool",
      conn,
    );
    expect((first.result as { self: { id: string } }).self.id).toBe("twin");

    // Same connection, no ppid this time: identity must NOT re-race.
    const second = await call(db, { tool: "agents_list", args: {}, token }, "call_tool", conn);
    expect((second.result as { self: { id: string } }).self.id).toBe("twin");
  });

  it("keeps a shared token working for the siblings still alive", async () => {
    const token = shareOneToken();
    revokeAgentMcpToken("twin"); // one session exits

    const res = await call(db, { tool: "agents_list", args: {}, token });
    expect(res.error).toBeUndefined();
    expect((res.result as { self: { id: string } }).self.id).toBe("writer");
  });
});

// T175: claims were advisory AND unobservable — in a shared tree git cannot say
// which agent dirtied a file. The write is the last moment attribution exists.
describe("check_path guard", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    for (const id of ["writer", "reader"]) revokeAgentMcpToken(id);
  });

  async function checkPath(token: string | undefined, path: string) {
    const { socket, responses } = fakeSocket();
    await handleRequest(db, socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "check_path",
      params: { token, path },
    });
    return responses[0]?.result as { allowed: boolean; heldBy?: string };
  }

  it("blocks a write to a path another live agent holds", async () => {
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','reader','p1','/repo/src/auth.ts')",
    ).run();
    const res = await checkPath(registerAgentMcpToken("writer", "p1"), "/repo/src/auth.ts");
    expect(res.allowed).toBe(false);
    expect(res.heldBy).toBe("reader");
  });

  it("allows an agent to write what it claimed itself", async () => {
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','writer','p1','/repo/src/auth.ts')",
    ).run();
    const res = await checkPath(registerAgentMcpToken("writer", "p1"), "/repo/src/auth.ts");
    expect(res.allowed).toBe(true);
  });

  it("blocks a file inside a claimed directory", async () => {
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','reader','p1','/repo/convex')",
    ).run();
    const res = await checkPath(registerAgentMcpToken("writer", "p1"), "/repo/convex/ai.ts");
    expect(res.allowed).toBe(false);
  });

  it("fails OPEN when the caller cannot be identified", async () => {
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','reader','p1','/repo/src/auth.ts')",
    ).run();
    // Blocking an unidentifiable caller would stop an agent working across an
    // app restart — far worse than a missed collision.
    expect((await checkPath(undefined, "/repo/src/auth.ts")).allowed).toBe(true);
    expect((await checkPath("not-a-token", "/repo/src/auth.ts")).allowed).toBe(true);
  });

  // macOS makes this the DEFAULT case, not an edge one: /tmp is a symlink to
  // /private/tmp, so a project added under it stored claims one way and the
  // guard asked the other — and enforcement silently did nothing for that whole
  // project, with no signal anywhere.
  it("matches a claim through a symlinked path", async () => {
    const real = mkdtempSync(join(tmpdir(), "exegol-real-"));
    const link = join(mkdtempSync(join(tmpdir(), "exegol-link-")), "repo");
    symlinkSync(real, link);
    mkdirSync(join(real, "src"), { recursive: true });

    // Stored the way claim_paths stores it: resolved through realpath.
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','reader','p1',?)",
    ).run(join(realpathSync(real), "src"));

    // The guard asks with the symlinked spelling; the claim was stored resolved.
    const res = await checkPath(
      registerAgentMcpToken("writer", "p1"),
      join(link, "src", "auth.ts"),
    );
    expect(res.allowed).toBe(false);
    expect(res.heldBy).toBe("reader");
  });

  it("allows when the claim holder is no longer live", async () => {
    db.prepare("UPDATE agents SET status = 'completed' WHERE id = 'reader'").run();
    db.prepare(
      "INSERT INTO path_claims (id, agent_id, project_id, path) VALUES ('c1','reader','p1','/repo/src/auth.ts')",
    ).run();
    const res = await checkPath(registerAgentMcpToken("writer", "p1"), "/repo/src/auth.ts");
    expect(res.allowed).toBe(true);
  });
});
