import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const ptyMock = vi.hoisted(() => ({
  writes: [] as Array<{ id: string; data: string }>,
  alive: new Set<string>(),
}));
const events = vi.hoisted(() => [] as Array<{ channel: string; payload: unknown }>);
const dbHolder = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock("../db/client", () => ({ getDb: () => dbHolder.db }));
vi.mock("../lib/event-bus", () => ({
  broadcast: (channel: string, payload: unknown) => events.push({ channel, payload }),
}));
vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({
    isAlive: (id: string) => ptyMock.alive.has(id),
    write: (id: string, data: string) => ptyMock.writes.push({ id, data }),
  }),
}));

import {
  clearAgentMessageQueue,
  deliverPendingAgentMessages,
  noteAgentOutput,
  sendAgentMessage,
  setAgentAwaitingApproval,
  stopSweep,
} from "./agent-messaging";
import {
  dropFollowUps,
  listFollowUps,
  queueFollowUp,
  removeFollowUp,
  STEER_TIMEOUT_MS,
  steerFollowUp,
  waitUntil,
} from "./follow-up-queue";

let db: Database.Database;

function insertAgent(id: string, status: string, cliType = "claude-code"): void {
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
     VALUES (?, 'p1', ?, ?, 'do things', unixepoch())`,
  ).run(id, cliType, status);
  ptyMock.alive.add(id);
}

function setStatus(id: string, status: string): void {
  db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
}

const typed = () => ptyMock.writes.map((w) => w.data).join("");

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
  dbHolder.db = db;
  ptyMock.writes.length = 0;
  ptyMock.alive.clear();
  events.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});

afterEach(() => {
  for (const id of ["a1", "a2", "s1"]) {
    dropFollowUps(id);
    clearAgentMessageQueue(db, id);
    setAgentAwaitingApproval(id, false);
  }
  stopSweep();
  vi.useRealTimers();
});

describe("follow-up queue", () => {
  it("queues while the agent works, lists, removes, and pushes each change", () => {
    insertAgent("a1", "running");
    const first = queueFollowUp(db, "a1", "add tests");
    queueFollowUp(db, "a1", "then update the docs");
    expect(first.delivered).toBe(false);
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["add tests", "then update the docs"]);
    expect(ptyMock.writes).toHaveLength(0);

    expect(removeFollowUp("a1", first.id)).toBe(true);
    expect(removeFollowUp("a1", first.id)).toBe(false);
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["then update the docs"]);
    expect(events.at(-1)).toEqual({
      channel: "agent:follow-ups",
      payload: { agentId: "a1", items: listFollowUps("a1") },
    });
  });

  it("delivers one per turn boundary, raw (no agent framing), once", () => {
    insertAgent("a1", "running");
    queueFollowUp(db, "a1", "first");
    queueFollowUp(db, "a1", "second");

    deliverPendingAgentMessages(db, "a1");
    expect(typed()).toContain("\x1b[200~first\x1b[201~");
    expect(typed()).not.toContain("Exegol message");
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["second"]);
    expect(events.at(-1)?.payload).toEqual({ agentId: "a1", items: listFollowUps("a1") });

    deliverPendingAgentMessages(db, "a1");
    deliverPendingAgentMessages(db, "a1");
    expect(typed().match(/second/g)).toHaveLength(1);
    expect(listFollowUps("a1")).toEqual([]);
  });

  it("types now when the agent sits at its prompt with nothing queued", () => {
    insertAgent("a1", "waiting_input");
    expect(queueFollowUp(db, "a1", "go on").delivered).toBe(true);
    expect(typed()).toContain("go on");
    expect(listFollowUps("a1")).toEqual([]);
  });

  it("never types over a permission prompt", () => {
    insertAgent("a1", "waiting_input");
    setAgentAwaitingApproval("a1", true);
    expect(queueFollowUp(db, "a1", "go on").delivered).toBe(false);
    expect(ptyMock.writes).toHaveLength(0);
  });

  it("refuses shells, ended sessions and a CLI back at its shell prompt", () => {
    insertAgent("s1", "running", "shell");
    insertAgent("a1", "completed");
    insertAgent("a2", "idle");
    db.prepare("UPDATE agents SET launched_in_shell = 1 WHERE id = 'a2'").run();
    for (const id of ["s1", "a1", "a2", "missing"]) {
      expect(() => queueFollowUp(db, id, "x")).toThrow(/live agent/);
    }
  });

  it("leaves agent_send messages alone: remove and drop touch only follow-ups", () => {
    insertAgent("a1", "running");
    insertAgent("a2", "running");
    const msg = sendAgentMessage(db, { fromAgentId: "a1", toAgentId: "a2", text: "hello" });
    queueFollowUp(db, "a2", "mine");
    expect(removeFollowUp("a2", msg.messageId)).toBe(false);
    dropFollowUps("a2");
    expect(listFollowUps("a2")).toEqual([]);
    deliverPendingAgentMessages(db, "a2");
    expect(typed()).toContain("hello");
  });
});

describe("steer", () => {
  it("sends Esc, waits for the prompt, then types", async () => {
    insertAgent("a1", "running");
    noteAgentOutput("a1");
    const pending = steerFollowUp(db, "a1", "stop, use the other API");
    expect(typed()).toBe("\x1b");
    expect(listFollowUps("a1")).toHaveLength(1);

    // Still printing: not yet
    await vi.advanceTimersByTimeAsync(1_000);
    noteAgentOutput("a1");
    await vi.advanceTimersByTimeAsync(500);
    setStatus("a1", "waiting_input");
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toMatchObject({ delivered: true });
    expect(typed()).toContain("stop, use the other API");
    expect(listFollowUps("a1")).toEqual([]);
  });

  it("jumps ahead of queued follow-ups and is delivered once when a boundary comes first", async () => {
    insertAgent("a1", "running");
    noteAgentOutput("a1");
    queueFollowUp(db, "a1", "later");
    const pending = steerFollowUp(db, "a1", "now");
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["now", "later"]);

    deliverPendingAgentMessages(db, "a1");
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toMatchObject({ delivered: true });
    expect(typed().match(/now/g)).toHaveLength(1);
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["later"]);
  });

  it("counts a quiet terminal after the Esc as the prompt (no hook on interrupt)", async () => {
    insertAgent("a1", "running");
    noteAgentOutput("a1");
    const pending = steerFollowUp(db, "a1", "redirect");
    await vi.advanceTimersByTimeAsync(1_750);
    await expect(pending).resolves.toMatchObject({ delivered: true });
    expect(typed()).toContain("redirect");
  });

  it("past the 20s cap leaves it queued for the next boundary", async () => {
    insertAgent("a1", "running");
    setAgentAwaitingApproval("a1", true);
    const pending = steerFollowUp(db, "a1", "redirect");
    await vi.advanceTimersByTimeAsync(STEER_TIMEOUT_MS + 500);
    await expect(pending).resolves.toMatchObject({ delivered: false });
    expect(listFollowUps("a1").map((i) => i.text)).toEqual(["redirect"]);
    expect(typed()).toBe("\x1b");
  });

  it("types at once, without Esc, when the agent is already at its prompt", async () => {
    insertAgent("a1", "idle");
    await expect(steerFollowUp(db, "a1", "next")).resolves.toMatchObject({ delivered: true });
    expect(typed()).not.toContain("\x1b\x1b");
    expect(ptyMock.writes[0]?.data.startsWith("\x1b[200~")).toBe(true);
  });
});

describe("waitUntil", () => {
  it("resolves true as soon as the check holds", async () => {
    let ready = false;
    const p = waitUntil(() => ready, { timeoutMs: 1_000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    ready = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe(true);
  });

  it("resolves false at the cap", async () => {
    const p = waitUntil(() => false, { timeoutMs: 1_000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(p).resolves.toBe(false);
  });
});
