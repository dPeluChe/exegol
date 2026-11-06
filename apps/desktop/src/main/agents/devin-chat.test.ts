import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterAll, describe, expect, it, vi } from "vitest";
import { devinDbPath, devinPage, devinTurns, olderDevinPage } from "./devin-chat";

const message = (role: string, content: string, extra: object = {}) =>
  JSON.stringify({ role, content, ...extra });
const typed = (content: string) => message("user", content, { metadata: { is_user_input: true } });

describe("devinTurns", () => {
  it("skips a row of an unexpected shape", () => {
    const rows = ["not json", "null", message("assistant", "ok", { tool_calls: "x" }), typed("hi")];
    const turns = devinTurns(
      rows.map((chat_message, i) => ({ node_id: i, created_at: 5, chat_message })),
    );
    expect(turns.map((t) => t.text)).toEqual(["hi"]);
  });

  it("keeps typed text, replies and tool names, never tool output or injected rows", () => {
    const rows = [
      message("system", "rules"),
      typed("hi"),
      message("user", "reminder"),
      message("assistant", "on it", { tool_calls: [{ name: "read" }, { name: "exec" }] }),
      message("tool", "file contents"),
    ];
    const turns = devinTurns(
      rows.map((chat_message, i) => ({ node_id: i, created_at: 5, chat_message })),
    );
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "hi"],
      ["assistant", "on it"],
      ["tool", "read"],
      ["tool", "exec"],
    ]);
  });
});

describe("devinPage", () => {
  const dir = mkdtempSync(join(tmpdir(), "devin-chat-"));
  const path = join(dir, "sessions.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE sessions (id TEXT, working_directory TEXT, last_activity_at INTEGER,
      main_chain_id INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE message_nodes (session_id TEXT, node_id INTEGER, parent_node_id INTEGER,
      chat_message TEXT, created_at INTEGER)`);
  const insert = db.prepare("INSERT INTO message_nodes VALUES ('s', ?, ?, ?, 1)");
  const setHead = db.prepare("UPDATE sessions SET main_chain_id = ? WHERE id = 's'");
  db.prepare("INSERT INTO sessions VALUES ('s', '/repo', 10, 3, 0)").run();
  insert.run(1, null, typed("first"));
  insert.run(2, 1, message("assistant", "abandoned retry"));
  insert.run(3, 1, message("assistant", "kept"));

  const target = { id: null, cwds: ["/repo"], sinceSec: 5 };
  afterAll(() => {
    db.close();
    // libsql keeps the file open on Windows past close(), until GC: the temp dir may stay
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  it("follows the head's chain, skips other branches, then reads only what came after", () => {
    const first = devinPage(path, target, undefined);
    expect(first?.turns.map((t) => t.text)).toEqual(["first", "kept"]);
    expect(first?.reset).toBe(true);

    expect(devinPage(path, target, first?.cursor)?.turns).toEqual([]);

    insert.run(4, 3, typed("more"));
    setHead.run(4);
    const next = devinPage(path, target, first?.cursor);
    expect(next?.turns.map((t) => t.text)).toEqual(["more"]);
    expect(next?.reset).toBe(false);
  });

  it("starts over when a rewind took the last node seen out of the chain", () => {
    const page = devinPage(path, target, "s:2");
    expect(page?.reset).toBe(true);
    expect(page?.turns.map((t) => t.text)).toEqual(["first", "kept", "more"]);
  });

  it("marks a long chain and walks back from it", () => {
    for (let id = 5; id <= 100; id++) insert.run(id, id - 1, message("assistant", `t${id}`));
    setHead.run(100);
    const page = devinPage(path, target, undefined);
    expect(page?.turns[0]?.text).toBe("t21");
    expect(page?.older).toBe("s:20");
    const older = olderDevinPage(path, page?.older ?? "");
    expect(older.turns.at(-1)?.text).toBe("t20");
    expect(older.older).toBeNull();
  });

  it("gives up with nothing to read, for the terminal text to take over", () => {
    expect(devinPage(path, { ...target, sinceSec: 99 }, undefined)).toBeNull();
    expect(devinPage(join(dir, "missing.db"), target, undefined)).toBeNull();
  });
});

describe("devinDbPath", () => {
  it("lives in roaming app data on Windows", () => {
    vi.stubEnv("APPDATA", join("C:", "Roaming"));
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      expect(devinDbPath()).toBe(join("C:", "Roaming", "devin", "cli", "sessions.db"));
    } finally {
      platform.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
