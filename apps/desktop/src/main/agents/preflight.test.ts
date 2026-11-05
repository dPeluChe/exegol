import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCliType } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { runPreflight } from "./preflight";

describe("runPreflight", () => {
  it("skips the PATH check for the __shell__ sentinel", async () => {
    const result = await runPreflight({
      cliType: "shell" as AgentCliType,
      command: "__shell__",
      projectPath: process.cwd(),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("checks the worktree's repo, not a project root that is no repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "exegol-preflight-"));
    mkdirSync(join(root, "api", ".git"), { recursive: true });
    const base = { cliType: "shell" as AgentCliType, command: "__shell__", projectPath: root };
    const codes = async (extra: { worktreeRepo?: string }) =>
      (await runPreflight({ ...base, useWorktree: true, ...extra })).warnings.map((w) => w.code);
    expect(await codes({})).toContain("NOT_GIT_REPO");
    expect(await codes({ worktreeRepo: join(root, "api") })).not.toContain("NOT_GIT_REPO");
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks when the CLI command is not on PATH", async () => {
    const result = await runPreflight({
      cliType: "shell" as AgentCliType,
      command: "definitely-not-a-real-command-xyz",
      projectPath: process.cwd(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("CLI_NOT_FOUND");
  });

  it("blocks when the project path does not exist", async () => {
    const result = await runPreflight({
      cliType: "shell" as AgentCliType,
      command: "__shell__",
      projectPath: "/nonexistent/path/for/preflight/test",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PROJECT_PATH_MISSING");
  });
});
