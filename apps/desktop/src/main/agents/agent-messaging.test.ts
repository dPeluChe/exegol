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

import { createAgentLink, listLinksFrom } from "../db/queries/agent-links";
import {
  AgentMessagingError,
  clearAgentLinks,
  clearAgentMessageQueue,
  deliverPendingAgentMessages,
  fireAgentLinks,
  noteAgentHasLink,
  seedAgentLinkCache,
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
    expect(written?.data).toContain("WAITING for your reply");
    expect(written?.data).toContain('agent_send(target: "a1")');
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

  it("resolves targets by session alias (case-insensitive), errors on ambiguity", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    db.prepare("UPDATE agents SET alias = 'Revisor-API' WHERE id = 'a2'").run();
    ptyMock.alive.add("a2");

    const res = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "revisor-api", text: "hey" });
    expect(res.delivered).toBe(true);
    expect(ptyMock.writes[0]?.id).toBe("a2");

    // second live agent with the same alias → ambiguous
    insertAgent(db, "a3", "running");
    db.prepare("UPDATE agents SET alias = 'revisor-api' WHERE id = 'a3'").run();
    expect(() =>
      sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "Revisor-API", text: "again" }),
    ).toThrowError(/matches 2 live agents/);
  });

  it("uses the sender alias in the attribution header and as reply target", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    db.prepare("UPDATE agents SET alias = 'builder-1' WHERE id = 'a1'").run();
    ptyMock.alive.add("a2");

    sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "ping" });
    expect(ptyMock.writes[0]?.data).toContain('from agent "builder-1"');
    expect(ptyMock.writes[0]?.data).toContain('agent_send(target: "builder-1")');
  });

  it("expects_reply=false renders the closing framing instead", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    sendAgentMessage(db, {
      fromAgentId: "a1",
      toAgentId: "a2",
      text: "gracias, cerramos",
      expectsReply: false,
    });
    expect(ptyMock.writes[0]?.data).toContain("No reply expected");
    expect(ptyMock.writes[0]?.data).not.toContain("WAITING for your reply");
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

  it("marks cross-project senders in the attribution header", () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p2', 'OtherProj', '/tmp/p2')").run();
    insertAgent(db, "a1", "running");
    db.prepare("UPDATE agents SET project_id = 'p2' WHERE id = 'a1'").run();
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "cross ping" });
    expect(ptyMock.writes[0]?.data).toContain('DIFFERENT project: "OtherProj"');
    expect(ptyMock.writes[0]?.data).toContain("/tmp/p2");
  });

  it("same-project senders show the shared project name", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "local ping" });
    expect(ptyMock.writes[0]?.data).toContain('your same project ("Proj")');
  });

  it("fires one-shot links on the sender's turn boundary with role framing", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    db.prepare("UPDATE agents SET alias = 'juanito' WHERE id = 'a1'").run();
    ptyMock.alive.add("a2");

    createAgentLink(db, {
      fromAgentId: "a1",
      toAgentId: "a2",
      role: "reviewer",
      note: "revisa el diff",
    });
    noteAgentHasLink("a1");
    fireAgentLinks(db, "a1");

    expect(ptyMock.writes).toHaveLength(1);
    const data = ptyMock.writes[0]?.data ?? "";
    expect(data).toContain("REVIEWER");
    expect(data).toContain("revisa el diff");
    expect(data).toContain('from agent "juanito"');
    expect(data).toContain("WAITING for your reply");
    // one-shot: expired after firing
    expect(listLinksFrom(db, "a1")).toHaveLength(0);
    fireAgentLinks(db, "a1");
    expect(ptyMock.writes).toHaveLength(1);
  });

  it("notify-role links do not demand a reply and links die with the agent", () => {
    insertAgent(db, "a1", "running");
    insertAgent(db, "a2", "waiting_input");
    ptyMock.alive.add("a2");

    createAgentLink(db, { fromAgentId: "a1", toAgentId: "a2", role: "notify" });
    noteAgentHasLink("a1");
    clearAgentLinks(db, "a2"); // receiver dies first → link must vanish (cache-aware)
    seedAgentLinkCache(db); // rebuild cache from the now-empty table
    fireAgentLinks(db, "a1");
    expect(ptyMock.writes).toHaveLength(0);

    createAgentLink(db, { fromAgentId: "a1", toAgentId: "a2", role: "notify" });
    noteAgentHasLink("a1");
    fireAgentLinks(db, "a1");
    expect(ptyMock.writes[0]?.data).toContain("No reply expected");
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
