import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { getThread } from "../db/queries/inbox";
import { close, giveLastTurn, handOver, PERSON } from "../inbox/threads";
import { callInboxTool } from "./exegol-inbox-tools";
import type { ExegolToolContext } from "./exegol-protocol";
import type { InboxToolName } from "./inbox-tool-defs";

let db: Database.Database;

const session = (agentId: string, projectId = "p1"): ExegolToolContext => ({
  agentId,
  accessMode: "write",
  projectId,
});
const a1 = session("a1");
const a2 = session("a2");
const b1 = session("b1", "p2");

type Posted = { thread: string; similar_closed: { thread: string }[] };

const call = <T = Record<string, unknown>>(
  tool: InboxToolName,
  args: Record<string, unknown>,
  context = a1,
) => callInboxTool(db, tool, args, context) as Promise<T>;

const post = (title = "Form fails on Safari", more = {}) =>
  call<Posted>("inbox_post", { title, body: "It breaks", ...more });

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  for (const id of ["p1", "p2"]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, id, `/tmp/${id}`);
  }
  for (const [id, project] of [
    ["a1", "p1"],
    ["a2", "p1"],
    ["b1", "p2"],
  ]) {
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description) VALUES (?, ?, 'codex', 't')",
    ).run(id, project);
  }
});

describe("threads", () => {
  it("keeps who wrote each message, under the data marker", async () => {
    const { thread } = await post();
    const got = await call<{ untrusted_inbox_content: Record<string, unknown>[] }>("inbox_get", {
      thread,
    });
    expect(got.untrusted_inbox_content).toEqual([
      expect.objectContaining({ seq: 1, body: "It breaks", session: "a1", cli: "codex" }),
    ]);
  });

  it("reads only what is new with since_seq, and counts unread by project", async () => {
    const { thread } = await post();
    const unread = async () =>
      (await call<{ threads: { unread: number }[] }>("inbox_list", {})).threads[0]?.unread;
    expect(await unread()).toBe(1);
    await call("inbox_reply", { thread, body: "On it" }, a2);
    expect(await unread()).toBe(0);

    const got = await call<{ untrusted_inbox_content: { seq: number }[] }>("inbox_get", {
      thread,
      since_seq: 1,
    });
    expect(got.untrusted_inbox_content.map((m) => m.seq)).toEqual([2]);
  });

  it("stops at 6 agent messages, and one last turn lets one through", async () => {
    const { thread } = await post();
    for (let i = 0; i < 5; i++) await call("inbox_reply", { thread, body: "more" }, a2);
    const again = () => call("inbox_reply", { thread, body: "again" }, a2);
    await expect(again()).rejects.toThrow(/waits for a person/);

    giveLastTurn(db, thread);
    await again();
    await expect(again()).rejects.toThrow(/waits for a person/);
  });

  it("gives one last turn only at the limit", async () => {
    const { thread } = await post();
    expect(() => giveLastTurn(db, thread)).toThrow(/not waiting/);
  });

  it("gives a take to one session", async () => {
    const { thread } = await post();
    expect(await call("inbox_take", { thread }, a2)).toMatchObject({ taken: true });
    expect(await call("inbox_take", { thread })).toMatchObject({ taken: false });
    expect(getThread(db, thread, null)?.status).toBe("in_progress");
  });
});

describe("closing", () => {
  const closeArgs = (thread: string) => ({ thread, status: "resolved", resolution: "Fixed" });

  it("needs its line", async () => {
    const { thread } = await post();
    await expect(
      call("inbox_close", { ...closeArgs(thread), resolution: " " }, a2),
    ).rejects.toThrow(/resolution is required/);
  });

  it("is not for the session that opened it, but a person may", async () => {
    const { thread } = await post();
    await expect(call("inbox_close", closeArgs(thread))).rejects.toThrow(/opened a thread/);
    close(db, PERSON, thread, "dismissed", "Not needed");
    expect(getThread(db, thread, null)?.resolution).toBe("Not needed");
  });

  it("never reopens: a new thread references it", async () => {
    const { thread } = await post();
    await call("inbox_close", closeArgs(thread), a2);
    await expect(call("inbox_reply", { thread, body: "again" }, a2)).rejects.toThrow(/refs/);

    const next = await post("Safari form fails again");
    expect(next.similar_closed.map((t) => t.thread)).toEqual([thread]);

    const linked = await post("Safari form fails again", { refs: [thread] });
    expect(linked.similar_closed).toEqual([]);
    const got = await call<{ refs: { resolution: string }[] }>("inbox_get", {
      thread: linked.thread,
    });
    expect(got.refs).toEqual([expect.objectContaining({ thread, resolution: "Fixed" })]);
  });

  it("refuses a ref to a thread still open", async () => {
    const { thread } = await post();
    await expect(post("Other", { refs: [thread] })).rejects.toThrow(/still open/);
  });

  it("finds a past thread by its resolution", async () => {
    const { thread } = await post();
    await call("inbox_close", closeArgs(thread), a2);
    const found = await call<{ threads: unknown[] }>("inbox_list", {
      state: "closed",
      query: "Fixed",
    });
    expect(found.threads).toHaveLength(1);
  });
});

describe("reach", () => {
  it("keeps another project out", async () => {
    const { thread } = await post();
    await expect(call("inbox_get", { thread }, b1)).rejects.toThrow(/No inbox/);
  });

  it("shows a personal thread only to a project it was handed to", async () => {
    const { thread } = await post("For later", { target: "personal" });
    await expect(call("inbox_get", { thread })).rejects.toThrow(/No inbox/);

    handOver(db, thread, "p1");
    expect(await call("inbox_get", { thread })).toMatchObject({ title: "For later" });
    await expect(call("inbox_get", { thread }, b1)).rejects.toThrow(/No inbox/);
  });

  it("limits how many threads a session opens in an hour", async () => {
    for (let i = 0; i < 10; i++) await post(`Thread ${i}`);
    await expect(post("One more")).rejects.toThrow(/threads an hour/);
  });
});
