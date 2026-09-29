import Database from "libsql";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, BrowserWindow: {}, dialog: {}, powerSaveBlocker: {} }));

const { agentSessionCounts } = await import("./work-guard");

describe("agentSessionCounts", () => {
  it("counts sessions waiting at a prompt as open, not working; shells never count", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE agents (id TEXT, status TEXT, cli_type TEXT)");
    const add = db.prepare("INSERT INTO agents VALUES (?, ?, ?)");
    add.run("a", "running", "claude-code");
    add.run("b", "waiting_input", "claude-code"); // the 2026-09-29 auto-logout case
    add.run("c", "crashed", "claude-code");
    add.run("d", "running", "shell");
    expect(agentSessionCounts(db)).toEqual({ working: 1, open: 2 });
  });

  it("an idle machine asks nothing", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE agents (id TEXT, status TEXT, cli_type TEXT)");
    expect(agentSessionCounts(db)).toEqual({ working: 0, open: 0 });
  });
});
