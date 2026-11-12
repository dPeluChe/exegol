import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chosenClaudeServers,
  claudeServersFrom,
  knownClaudeServers,
  listClaudeServers,
  mcpSlice,
} from "./claude-servers";

const stdio = (command: string) => ({ command, env: { KEY: "secret" } });

describe("claudeServersFrom", () => {
  const user = {
    mcpServers: { tracker: { type: "http", url: "https://x.test/mcp" }, design: stdio("design") },
    projects: {
      "/work/app": { mcpServers: { design: stdio("design-local"), db: stdio("db") } },
      "/work/app/wt": { mcpServers: {} },
    },
  };
  const repoFile = { mcpServers: { db: stdio("db-repo"), exegol: stdio("mine") } };

  it("lists every scope by name, the nearer scope winning a repeated name", () => {
    const found = claudeServersFrom(user, [repoFile], ["/work/app"]);
    expect(found.map((s) => [s.name, s.scope, s.transport])).toEqual([
      ["db", "local", "stdio"],
      ["design", "local", "stdio"],
      ["tracker", "user", "http"],
    ]);
    expect(found.find((s) => s.name === "design")?.definition).toEqual(stdio("design-local"));
  });

  it("falls back to the next folder when the first has no servers of its own", () => {
    const names = (folders: string[], files: unknown[] = []) =>
      claudeServersFrom(user, files, folders).map((s) => `${s.name}:${s.scope}`);
    expect(names(["/work/app/wt", "/work/app"])).toContain("db:local");
    const onlyExegol = { mcpServers: { exegol: stdio("mine") } };
    expect(names(["/a", "/b"], [onlyExegol, repoFile])).toContain("db:project");
    expect(names(["/elsewhere"])).toEqual(["design:user", "tracker:user"]);
  });

  it("reads nothing from a missing or malformed config", () => {
    expect(claudeServersFrom(null, ["nope"], ["/work/app"])).toEqual([]);
    expect(claudeServersFrom({ mcpServers: ["a"], projects: 3 }, [{}], ["/work/app"])).toEqual([]);
  });
});

describe("mcpSlice", () => {
  it("keeps the servers and drops the rest of the config", () => {
    const config = {
      mcpServers: { a: stdio("a") },
      oauthAccount: { email: "x" },
      projects: { "/p": { history: ["prompt"], mcpServers: { b: stdio("b") } }, "/q": {} },
    };
    expect(mcpSlice(config)).toEqual({
      mcpServers: { a: stdio("a") },
      projects: { "/p": { mcpServers: { b: stdio("b") } } },
    });
  });
});

describe("reading Claude Code's files", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-servers-"));
  const repo = join(home, "repo");
  const before = process.env.CLAUDE_CONFIG_DIR;

  beforeAll(() => {
    mkdirSync(repo);
    process.env.CLAUDE_CONFIG_DIR = home;
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { design: stdio("design"), tracker: stdio("tracker") } }),
    );
    writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { db: stdio("db") } }));
  });

  afterAll(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists names, scope and transport, never a definition", async () => {
    const listed = await listClaudeServers(repo);
    expect(listed).toEqual([
      { name: "db", scope: "project", transport: "stdio" },
      { name: "design", scope: "user", transport: "stdio" },
      { name: "tracker", scope: "user", transport: "stdio" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("secret");
  });

  it("gives the process view a hint per local server, not its definition", async () => {
    expect(await knownClaudeServers(repo)).toContainEqual({ name: "db", hints: ["db"] });
  });

  it("gives a session the chosen definitions that still exist, and null without a list", async () => {
    expect(await chosenClaudeServers("a1", ["db", "gone"], [repo])).toEqual({ db: stdio("db") });
    expect(await chosenClaudeServers("a1", [], [repo])).toEqual({});
    expect(await chosenClaudeServers("a1", null, [repo])).toBeNull();
  });
});
