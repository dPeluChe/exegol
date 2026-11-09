import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { isCommanderTool } from "./commander-tool-defs";
import type { ExegolToolContext } from "./exegol-protocol";
import { EXEGOL_TOOL_DEFS, getToolDefsForAccessMode } from "./exegol-tool-defs";
import { callExegolTool, ExegolToolError } from "./exegol-tools";

function makeContext(overrides: Partial<ExegolToolContext> = {}): ExegolToolContext {
  return { agentId: "agent-1", accessMode: "write", projectId: "proj-1", ...overrides };
}

describe("exegol-tools", () => {
  let db: Database.Database;
  let projectPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projectPath = mkdtempSync(join(tmpdir(), "exegol-mcp-test-"));
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('proj-1', 'Test Project', ?)").run(
      projectPath,
    );
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description) VALUES ('agent-1', 'proj-1', 'claude-code', 'test task')",
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(projectPath, { recursive: true, force: true });
  });

  describe("getToolDefsForAccessMode", () => {
    it("returns all tools but the Commander's for write access", () => {
      expect(getToolDefsForAccessMode("write")).toEqual(
        EXEGOL_TOOL_DEFS.filter((t) => !isCommanderTool(t.name)),
      );
    });

    it("hides the browser's write tools for read/plan access, keeps notes and inbox", () => {
      const readTools = getToolDefsForAccessMode("read").map((t) => t.name);
      expect(readTools).toContain("note_write");
      expect(readTools).toContain("inbox_post");
      expect(readTools).not.toContain("browser_click");

      const planTools = getToolDefsForAccessMode("plan").map((t) => t.name);
      expect(planTools).not.toContain("browser_click");
    });
  });

  describe("callExegolTool", () => {
    it("rejects unknown tools", async () => {
      await expect(callExegolTool(db, "not_a_tool", {}, makeContext())).rejects.toThrow(
        ExegolToolError,
      );
    });

    it("agents_list shows who can read messages, in your project unless asked", async () => {
      db.prepare(
        "INSERT INTO projects (id, name, path) VALUES ('proj-2', 'Other', '/tmp/o')",
      ).run();
      const insert = db.prepare(
        "INSERT INTO agents (id, project_id, cli_type, status, task_description) VALUES (?, ?, ?, 'running', 't')",
      );
      insert.run("mate", "proj-1", "codex");
      insert.run("term", "proj-1", "shell");
      insert.run("far", "proj-2", "claude-code");
      db.prepare("UPDATE agents SET status = 'running' WHERE id = 'agent-1'").run();
      const ids = (r: unknown) => (r as { agents: { id: string }[] }).agents.map((a) => a.id);

      const own = await callExegolTool(db, "agents_list", {}, makeContext());
      expect(ids(own)).toEqual(["mate"]);
      expect(own).toMatchObject({ self: { id: "agent-1" }, inOtherProjects: 1 });

      const all = await callExegolTool(db, "agents_list", { all_projects: true }, makeContext());
      expect(ids(all).sort()).toEqual(["far", "mate"]);
    });

    it("agent_link refuses a plain terminal", async () => {
      db.prepare(
        "INSERT INTO agents (id, project_id, cli_type, status, task_description) VALUES ('term', 'proj-1', 'shell', 'running', 't')",
      ).run();
      await expect(
        callExegolTool(db, "agent_link", { target: "term" }, makeContext()),
      ).rejects.toThrow("plain terminal");
    });
  });

  describe("claim_paths", () => {
    const claim = (paths: string[]) => callExegolTool(db, "claim_paths", { paths }, makeContext());

    it("resolves relative paths against the agent's working directory", async () => {
      const res = (await claim(["src/auth.ts"])) as { granted: boolean; paths: string[] };
      expect(res.granted).toBe(true);
      // Stored through realpath — on macOS the temp dir is itself a symlink
      // (/var → /private/var), and a claim spelled differently from the guard's
      // question never overlaps, so enforcement silently does nothing.
      expect(res.paths).toEqual([join(realpathSync(projectPath), "src/auth.ts")]);
    });

    it("refuses a path that escapes the working directory", async () => {
      // `../..` resolves above the project and, under the prefix-overlap rule,
      // would collide with every path in it — one agent locking the whole fleet.
      await expect(claim(["../../etc"])).rejects.toThrow(/outside your working directory/);
      await expect(claim(["/etc/passwd"])).rejects.toThrow(/outside your working directory/);
    });

    it("release_paths with an empty array releases everything, as documented", async () => {
      await claim(["a.ts", "b.ts"]);
      const res = (await callExegolTool(db, "release_paths", { paths: [] }, makeContext())) as {
        released: number;
      };
      expect(res.released).toBe(2);
    });
  });
});
