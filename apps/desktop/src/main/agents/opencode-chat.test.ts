import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterAll, describe, expect, it } from "vitest";
import { olderOpencodePage, opencodePage, opencodeTurns } from "./opencode-chat";

const row = (seq: number, type: string, data: object) => ({
  seq,
  type,
  time_created: seq * 1000,
  data: JSON.stringify(data),
});
const done = { time: { completed: 1 } };
const said = (text: string) => ({ ...done, content: [{ type: "text", text }] });

describe("opencodeTurns", () => {
  it("keeps text and tool names, never reasoning", () => {
    const { turns } = opencodeTurns([
      row(1, "user", { text: "hi" }),
      row(2, "assistant", {
        ...done,
        content: [
          { type: "reasoning", text: "secret" },
          { type: "tool", name: "bash" },
          { type: "text", text: "done" },
        ],
      }),
    ]);
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "hi"],
      ["tool", "bash"],
      ["assistant", "done"],
    ]);
  });

  it("skips a row of an unexpected shape", () => {
    const { turns, last } = opencodeTurns([
      { seq: 1, type: "user", time_created: 1000, data: "not json" },
      row(2, "assistant", { ...done, content: "text" }),
      row(3, "user", { text: "hi" }),
    ]);
    expect(turns.map((t) => t.text)).toEqual(["hi"]);
    expect(last).toBe(3);
  });

  it("stops at a step still running, so the cursor comes back to it", () => {
    const { turns, last } = opencodeTurns([
      row(1, "user", { text: "hi" }),
      row(2, "assistant", { content: [{ type: "text", text: "partial" }] }),
      row(3, "user", { text: "later" }),
    ]);
    expect(turns).toHaveLength(1);
    expect(last).toBe(1);
  });
});

describe("opencodePage", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-chat-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE session_v2 (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER);
    CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, seq INTEGER,
      time_created INTEGER, data TEXT);`);
  const addSession = db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?)");
  addSession.run("old", "/w", null, 100);
  addSession.run("new", "/w", null, 200);
  addSession.run("child", "/w", "new", 300);
  const add = (seq: number, session = "new") =>
    db
      .prepare("INSERT INTO session_message VALUES (?, ?, 'assistant', ?, ?, ?)")
      .run(`m${session}${seq}`, session, seq, seq * 1000, JSON.stringify(said(`t${seq}`)));
  for (let seq = 1; seq <= 90; seq++) add(seq);
  db.close();
  afterAll(() => {
    // libsql keeps the file open on Windows past close(), until GC: the temp dir may stay
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  it("reads the newest top-level session, then only what came after", () => {
    const first = opencodePage(path, ["/w"], 0, undefined);
    expect(first?.reset).toBe(true);
    expect(first?.turns.at(-1)?.text).toBe("t90");
    expect(first?.cursor).toBe("new:90");

    const writer = new Database(path);
    writer
      .prepare("INSERT INTO session_message VALUES ('x', 'new', 'user', 91, 91000, ?)")
      .run(JSON.stringify({ text: "next" }));
    writer.close();
    const next = opencodePage(path, ["/w"], 0, first?.cursor);
    expect(next?.reset).toBe(false);
    expect(next?.turns.map((t) => t.text)).toEqual(["next"]);
  });

  it("walks back from the older mark", () => {
    const first = opencodePage(path, ["/w"], 0, undefined);
    const older = olderOpencodePage(path, first?.older ?? "");
    expect(older.turns.at(-1)?.text).toBe(`t${Number(first?.older?.split(":")[1]) - 1}`);
    expect(older.older).toBeNull();
  });

  it("gives up on nothing to read, for the terminal text to take over", () => {
    expect(opencodePage(path, ["/elsewhere"], 0, undefined)).toBeNull();
    expect(opencodePage(path, ["/w"], 999, undefined)).toBeNull();
    expect(opencodePage(join(dir, "missing.db"), ["/w"], 0, undefined)).toBeNull();
  });
});
