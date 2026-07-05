import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import type { ExegolToolContext } from "./exegol-protocol";
import {
  callExegolTool,
  EXEGOL_TOOL_DEFS,
  ExegolToolError,
  getToolDefsForAccessMode,
} from "./exegol-tools";

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
    db.prepare(
      "INSERT INTO projects (id, name, path) VALUES ('proj-1', 'Test Project', ?)",
    ).run(projectPath);
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description) VALUES ('agent-1', 'proj-1', 'claude-code', 'test task')",
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(projectPath, { recursive: true, force: true });
  });

  describe("getToolDefsForAccessMode", () => {
    it("returns all tools for write access", () => {
      expect(getToolDefsForAccessMode("write")).toEqual(EXEGOL_TOOL_DEFS);
    });

    it("hides memory_save for read/plan access", () => {
      const readTools = getToolDefsForAccessMode("read").map((t) => t.name);
      expect(readTools).toContain("memory_search");
      expect(readTools).toContain("knowledge_get");
      expect(readTools).not.toContain("memory_save");

      const planTools = getToolDefsForAccessMode("plan").map((t) => t.name);
      expect(planTools).not.toContain("memory_save");
    });
  });

  describe("callExegolTool", () => {
    it("rejects unknown tools", async () => {
      await expect(callExegolTool(db, "not_a_tool", {}, makeContext())).rejects.toThrow(
        ExegolToolError,
      );
    });

    it("memory_save creates a fact attributed to the calling agent", async () => {
      const result = (await callExegolTool(
        db,
        "memory_save",
        { fact: "Uses pnpm for package management", category: "convention" },
        makeContext(),
      )) as { id: string };

      expect(result.id).toBeTruthy();
      const row = db.prepare("SELECT source_agent_id FROM memories WHERE id = ?").get(result.id) as {
        source_agent_id: string;
      };
      expect(row.source_agent_id).toBe("agent-1");
    });

    it("memory_save rejects read-mode agents", async () => {
      await expect(
        callExegolTool(
          db,
          "memory_save",
          { fact: "Should not be saved", category: "convention" },
          makeContext({ accessMode: "read" }),
        ),
      ).rejects.toThrow(/write access/);
    });

    it("memory_search finds a previously saved fact", async () => {
      await callExegolTool(
        db,
        "memory_save",
        { fact: "Prefer bun over npm for this repo", category: "preference" },
        makeContext(),
      );

      const result = (await callExegolTool(
        db,
        "memory_search",
        { query: "bun" },
        makeContext({ accessMode: "read" }),
      )) as { facts: Array<{ content: string }> };

      expect(result.facts.some((f) => f.content.includes("bun"))).toBe(true);
    });

    it("knowledge_get returns the brief and digest", async () => {
      const result = (await callExegolTool(db, "knowledge_get", {}, makeContext())) as {
        brief: string;
        digest: string;
      };
      expect(result.brief).toContain("What it does");
      expect(result.digest).toContain("Codebase Digest");
    });

    it("knowledge_get respects the section filter", async () => {
      const result = (await callExegolTool(
        db,
        "knowledge_get",
        { section: "brief" },
        makeContext({ accessMode: "read" }),
      )) as { brief?: string; digest?: string };
      expect(result.brief).toBeTruthy();
      expect(result.digest).toBeUndefined();
    });
  });
});
