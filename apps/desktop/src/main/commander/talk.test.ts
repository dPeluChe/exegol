import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { listActiveAgents } from "../db/queries/agents";
import { listCommanderLog } from "../db/queries/commander-log";
import { listTalkSince, messageCursor, sendMessage } from "../db/queries/messages";
import { setJsonSetting } from "../db/queries/settings";
import type { ExegolToolContext } from "../mcp/exegol-protocol";
import { callExegolTool } from "../mcp/exegol-tools";
import { feedSnapshot, talkEvents } from "./feed";
import { mainSessionId, talksWith } from "./fleet";
import { fleetOf } from "./tools";

let db: Database.Database;
const commander: ExegolToolContext = { agentId: "cmd", accessMode: "write", projectId: "home" };

const say = (from: string | null, to: string, content: string) =>
  sendMessage(db, { fromAgentId: from, toAgentId: to, type: "text", content }).id;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  for (const [id, name] of [
    ["home", "Commander"],
    ["p1", "Brow"],
    ["p2", "Docs"],
  ]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, name, `/x/${id}`);
  }
  const agent = db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, task_description, status, alias, started_at, resumed_from)
     VALUES (?, ?, 'claude-code', 't', ?, ?, ?, ?)`,
  );
  agent.run("cmd", "home", "waiting_input", "commander", 50, null);
  agent.run("a0", "p1", "stopped", "browdev", 100, null);
  agent.run("a1", "p1", "stopped", "browdev", 250, "a0");
  agent.run("a", "p1", "waiting_input", "browdev", 300, "a1");
  agent.run("b", "p1", "running", "onyx", 200, null);
  agent.run("c2345678901", "p1", "running", null, 400, null);
  agent.run("d", "p2", "running", "dex", 500, null);
  setJsonSetting(db, "commander_project_id", "home");
});

const sessions = () =>
  new Map(
    fleetOf(db, "cmd", listActiveAgents(db), { relations: true })
      .flatMap((p) => p.sessions)
      .map((s) => [s.id, s]),
  );

describe("the main session", () => {
  it("is the one whose first row is oldest, so a resume keeps it", () => {
    const fleet = sessions();
    const main = [...fleet.values()].filter((s) => s.main).map((s) => s.id);
    expect(main).toEqual(["a", "d"]);
    expect(fleet.get("b")).not.toHaveProperty("main");
  });

  it("breaks ties by its own row, then its id, and takes a live preferred one", () => {
    const s = (id: string, startedAt: number, lineageStart?: number) => ({
      id,
      startedAt,
      lineageStart,
    });
    expect(mainSessionId([s("x", 9, 5), s("y", 7, 5), s("z", 6)])).toBe("y");
    expect(mainSessionId([s("y", 5), s("x", 5)])).toBe("x");
    expect(mainSessionId([s("x", 1), s("y", 2)], "y")).toBe("y");
    expect(mainSessionId([s("x", 1), s("y", 2)], "gone")).toBe("x");
    expect(mainSessionId([])).toBeNull();
  });
});

describe("talks_with", () => {
  it("names who a session exchanged messages with, without notices, the Commander or old ones", () => {
    const old = say("c2345678901", "a", "long ago");
    db.prepare("UPDATE messages SET created_at = unixepoch() - 90000 WHERE id = ?").run(old);
    say("a", "b", "review this");
    say("b", "a", "done");
    say("cmd", "a", "from the commander");
    say(null, "a", "a notice");
    const fleet = sessions();
    const [a, b, c] = ["a", "b", "c2345678901"].map((id) => fleet.get(id));
    expect(a?.talks_with).toEqual([{ session: "onyx", id: "b", minutes_ago: 0, last: "received" }]);
    expect(b?.talks_with).toEqual([{ session: "browdev", id: "a", minutes_ago: 0, last: "sent" }]);
    expect(c).not.toHaveProperty("talks_with");
  });

  it("keeps the three most recent", () => {
    const names = new Map(["a", "b", "c", "d", "e"].map((id) => [id, id]));
    const pairs = ["b", "c", "d", "e"].map((toId, i) => ({ fromId: "a", toId, at: 0, seq: i }));
    const talks = talksWith([...pairs, { fromId: "c", toId: "a", at: 60, seq: 9 }], names, 180_000);
    expect(talks.get("a")).toEqual([
      { session: "c", id: "c", minutes_ago: 2, last: "received" },
      { session: "e", id: "e", minutes_ago: 3, last: "sent" },
      { session: "d", id: "d", minutes_ago: 3, last: "sent" },
    ]);
  });
});

describe("the feed's talk lines", () => {
  it("say who wrote and who answered, one line per pair, with the length and never the text", () => {
    const fleet = fleetOf(db, "cmd", listActiveAgents(db));
    const { sessions: live } = feedSnapshot(fleet, 0);
    say("a", "b", "before the look");
    const cursor = messageCursor(db);
    say("b", "a", "x".repeat(9485));
    say("a", "c2345678901", "secret words");
    say("d", "a", "x".repeat(3000));
    say("d", "a", "x".repeat(850));
    say("cmd", "a", "from the commander");
    say(null, "b", "a notice");
    const lines = talkEvents(listTalkSince(db, [...live.keys()], cursor), live).map((e) => e.line);
    expect(lines).toEqual([
      "onyx answered browdev in Brow (9,485 characters)",
      "browdev wrote to c2345678 in Brow (12 characters)",
      "dex (Docs) wrote to browdev (Brow) (2 messages, 3,850 characters)",
    ]);
  });
});

describe("session_messages", () => {
  const read = (args: Record<string, unknown>) =>
    callExegolTool(db, "session_messages", args, commander) as Promise<{
      with?: string;
      untrusted_message_content: Record<string, unknown>[] & Record<string, unknown>;
    }>;

  it("lists previews oldest first, one message in full, and refuses another session's", async () => {
    const long = say("a", "b", "y".repeat(300));
    say("b", "a", "ok");
    say("c2345678901", "a", "hello");
    say(null, "a", "a notice");
    const other = say("b", "c2345678901", "not yours");

    const all = await read({ session: "browdev" });
    expect(all.untrusted_message_content.map((m) => [m.from, m.to, m.chars, m.truncated])).toEqual([
      ["browdev", "onyx", 300, true],
      ["onyx", "browdev", 2, undefined],
      ["c2345678", "browdev", 5, undefined],
    ]);
    expect(all.untrusted_message_content[0]).toMatchObject({
      id: long,
      read: false,
      delivery_state: null,
      preview: "y".repeat(200),
    });
    expect(String(all.untrusted_message_content[0]?.at)).toMatch(/^\d{4}-.*Z$/);

    const pair = await read({ session: "browdev", with: "onyx", limit: 1 });
    expect(pair.with).toBe("onyx");
    expect(pair.untrusted_message_content.map((m) => m.preview)).toEqual(["ok"]);

    const full = await read({ session: "a", message_id: long });
    expect(full.untrusted_message_content).toMatchObject({ chars: 300, body: "y".repeat(300) });
    expect(full.untrusted_message_content).not.toHaveProperty("preview");

    await expect(read({ session: "a", message_id: other })).rejects.toThrow("No message");
    expect(listCommanderLog(db, 10)).toEqual([]);
  });
});
