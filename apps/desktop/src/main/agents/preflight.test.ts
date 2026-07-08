import type { AgentCliType } from "@exegol/shared";
import type Database from "libsql";
import { describe, expect, it } from "vitest";
import { runPreflight } from "./preflight";

const db = {} as Database.Database;

describe("runPreflight", () => {
  it("skips the PATH check for the __shell__ sentinel", async () => {
    const result = await runPreflight(db, {
      cliType: "shell" as AgentCliType,
      command: "__shell__",
      projectPath: process.cwd(),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("blocks when the CLI command is not on PATH", async () => {
    const result = await runPreflight(db, {
      cliType: "shell" as AgentCliType,
      command: "definitely-not-a-real-command-xyz",
      projectPath: process.cwd(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("CLI_NOT_FOUND");
  });

  it("blocks when the project path does not exist", async () => {
    const result = await runPreflight(db, {
      cliType: "shell" as AgentCliType,
      command: "__shell__",
      projectPath: "/nonexistent/path/for/preflight/test",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PROJECT_PATH_MISSING");
  });
});
