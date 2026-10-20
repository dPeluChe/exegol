import Database from "libsql";
import { describe, expect, it, vi } from "vitest";

vi.mock("../mcp/exegol-server", () => ({ revokeAgentMcpToken: vi.fn() }));
vi.mock("./spawn-env", async (orig) => ({
  ...(await orig<object>()),
  broadcastAgentStatus: vi.fn(),
  forgetBroadcastStatus: vi.fn(),
}));

import { runMigrations } from "../db/migrations";
import { settleAllReattach } from "../terminal/reattach-gate";
import type { SessionMaps } from "./agent-session-callbacks";
import { handleLostSession, lostStep } from "./lost-session-exit";
import { settleLost, takeLostOnRestart } from "./lost-sessions";

function maps(): SessionMaps {
  return {
    outputProcessors: new Map(),
    titleTrackers: new Map(),
    scrollbackBuffers: new Map(),
    scrollbackSizes: new Map(),
    completionCallbacks: new Map(),
    initialSnapshots: new Map(),
    dataCallbacks: new Map(),
    sessionIdsCaptured: new Set(),
    stopRequested: new Set(),
    contexts: new Map(),
  };
}

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, pid)
     VALUES ('sh', 'p1', 'shell', 'running', 't', 1, 99)`,
  ).run();
  return db;
}

const agent = { id: "sh", cliType: "shell", projectId: "p1", taskDescription: "" } as never;

describe("a session lost with the sidecar under the running app", () => {
  it("is crashed with the stop's reason, kept (a shell too) and added to the lost list", async () => {
    const db = setupDb();
    settleAllReattach();
    handleLostSession(db, agent, maps(), "SIGTERM", true);
    const row = db.prepare("SELECT status, current_step, pid FROM agents WHERE id = 'sh'").get();
    expect(row).toMatchObject({ status: "crashed", current_step: lostStep("SIGTERM"), pid: null });
    expect((await takeLostOnRestart()).map((s) => s.id)).toEqual(["sh"]);
    settleLost(["sh"]);
  });

  it("before a relaunch it leaves the row to startup recovery", async () => {
    const db = setupDb();
    handleLostSession(db, agent, maps(), "shutdown requested", false);
    const row = db.prepare("SELECT status FROM agents WHERE id = 'sh'").get();
    expect(row).toMatchObject({ status: "running" });
    expect(await takeLostOnRestart()).toEqual([]);
  });
});
