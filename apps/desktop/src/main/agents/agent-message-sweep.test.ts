import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const screen = vi.hoisted(() => ({ dialog: null as object | null }));
const events = vi.hoisted(() => [] as Array<{ channel: string; payload: unknown }>);
const dbHolder = vi.hoisted(() => ({ db: null as unknown as Database.Database }));
const emit = vi.hoisted(() => vi.fn());

vi.mock("../db/client", () => ({ getDb: () => dbHolder.db }));
vi.mock("../notifications/bus", () => ({ getNotificationBus: () => ({ emit }) }));
vi.mock("../lib/event-bus", () => ({
  broadcast: (channel: string, payload: unknown) => events.push({ channel, payload }),
}));
vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({ holdsEnter: () => screen.dialog != null }),
}));

import { drainQueue, setAgentAwaitingApproval, storeQueue } from "./agent-message-queue";
import type { PendingMessage } from "./agent-message-state";
import { ensureSweep, forgetSweepState, noteAgentOutput, stopSweep } from "./agent-message-sweep";

const AGENT = "held";
const STALL_MS = 60_000;
const deliver = vi.fn();
const held = () => events.filter((e) => e.channel === "agent:message-held");

describe("a queue behind a screen dialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dbHolder.db = new Database(":memory:");
    runMigrations(dbHolder.db);
    dbHolder.db
      .prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Project', '/tmp/p1')")
      .run();
    dbHolder.db
      .prepare(
        `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
         VALUES (?, 'p1', 'opencode', 'waiting_input', 'do things', unixepoch())`,
      )
      .run(AGENT);
    events.length = 0;
    emit.mockClear();
    deliver.mockClear();
    screen.dialog = { question: "Allow?" };
    storeQueue(AGENT, [{ messageId: "m1" } as PendingMessage]);
    noteAgentOutput(AGENT);
    ensureSweep(deliver);
  });

  afterEach(() => {
    stopSweep();
    drainQueue(AGENT);
    setAgentAwaitingApproval(AGENT, false);
    forgetSweepState(AGENT);
    dbHolder.db.close();
    vi.useRealTimers();
  });

  it("raises one notice past the stall, and never delivers into the dialog", () => {
    vi.advanceTimersByTime(STALL_MS - 2_000);
    expect(held()).toEqual([]);

    vi.advanceTimersByTime(STALL_MS);
    expect(held()).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ type: "agent:notice", agentId: AGENT });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("stays quiet when a hook reported the approval: that one already raised attention", () => {
    setAgentAwaitingApproval(AGENT, true);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(held()).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers once the dialog is gone, and tells again about a later hold", () => {
    vi.advanceTimersByTime(STALL_MS * 2);
    screen.dialog = null;
    vi.advanceTimersByTime(2_000);
    expect(deliver).toHaveBeenCalledWith(AGENT);

    screen.dialog = { question: "Allow?" };
    vi.advanceTimersByTime(2_000);
    expect(held()).toHaveLength(2);
  });
});
