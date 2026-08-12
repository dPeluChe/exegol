import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const ptyMock = vi.hoisted(() => ({
  writes: [] as Array<{ id: string; data: string }>,
  alive: new Set<string>(),
}));

vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({
    isAlive: (id: string) => ptyMock.alive.has(id),
    write: (id: string, data: string) => ptyMock.writes.push({ id, data }),
  }),
}));

import {
  AgentMessagingError,
  clearAgentMessageQueue,
  deliverPendingAgentMessages,
  sendAgentMessage,
} from "./agent-messaging";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
  return db;
}

function insertAgent(db: Database.Database, id: string, status: string): void {
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
     VALUES (?, 'p1', 'claude-code', ?, 'do things', unixepoch())`,
  ).run(id, status);
}

function messageCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
}

describe("sendAgentMessage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    ptyMock.writes.length = 0;
    ptyMock.alive.clear();
    // Runtime queues/dedup are module-level: isolate tests by clearing targets.
    for (const id of ["a1", "a2", "a3"]) clearAgentMessageQueue(id);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
  });

  it("delivers immediately to a target at its prompt, with attribution + submit", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    const res = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "hola a2" });

    expect(res.delivered).toBe(true);
    expect(ptyMock.writes).toHaveLength(1);
    const written = ptyMock.writes[0];
    expect(written?.id).toBe("a2");
    expect(written?.data).toContain("hola a2");
    expect(written?.data).toContain("NOT the user");
    expect(written?.data).toContain('from agent "claude-code');
    expect(written?.data.endsWith("\r")).toBe(true);
    expect(written?.data).toContain("\x1b[200~");
    expect(messageCount(db)).toBe(1);
  });

  it("queues for a busy target and delivers ONE per turn boundary", () => {
    insertAgent(db, "a1", "waiting_input");
    insertAgent(db, "a2", "running");
    ptyMock.alive.add("a2");

    const r1 = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "first" });
    const r2 = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "second" });
    expect(r1.delivered).toBe(false);
    expect(r2.delivered).toBe(false);
    expect(ptyMock.writes).toHaveLength(0);

    deliverPendingAgentMessages("a2");
    expect(ptyMock.writes).toHaveLength(1);
    expect(ptyMock.writes[0]?.data).toContain("first");

    deliverPendingAgentMessages("a2");
    expect(ptyMock.writes).toHaveLength(2);
    expect(ptyMock.writes[1]?.data).toContain("second");

    deliverPendingAgentMessages("a2");
    expect(ptyMock.writes).toHaveLength(2);
  });

  it("throttles duplicate sends inside the dedup window, allows after it", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "same" });
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "same" }),
    ).toThrowError(AgentMessagingError);

    vi.advanceTimersByTime(31_000);
    const res = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "same" });
    expect(res.delivered).toBe(true);
  });

  it("rejects self-send, unknown target, empty text and terminal targets", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a3", "completed");

    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a1", text: "x" }),
    ).toThrowError(/yourself/);
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "ghost", text: "x" }),
    ).toThrowError(/unknown target/);
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a3", text: "  " }),
    ).toThrowError(/empty/);
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a3", text: "x" }),
    ).toThrowError(/not reachable/);
  });

  it("caps the per-target queue", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "running");

    for (let i = 0; i < 10; i++) {
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: `msg ${i}` });
    }
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "overflow" }),
    ).toThrowError(/queue is full/);
  });

  it("drops the runtime queue when the target PTY is gone, keeping DB records", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "running");

    sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "doomed" });
    // a2 never added to ptyMock.alive → injectNow fails
    deliverPendingAgentMessages("a2");
    expect(ptyMock.writes).toHaveLength(0);
    expect(messageCount(db)).toBe(1);
    // queue dropped: a later boundary delivers nothing
    ptyMock.alive.add("a2");
    deliverPendingAgentMessages("a2");
    expect(ptyMock.writes).toHaveLength(0);
  });
});
