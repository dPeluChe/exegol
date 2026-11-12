import { describe, expect, it } from "vitest";
import { claudeServersFrom } from "./claude-servers";

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
    const found = claudeServersFrom(user, repoFile, ["/work/app"]);
    expect(found.map((s) => [s.name, s.scope, s.transport])).toEqual([
      ["db", "local", "stdio"],
      ["design", "local", "stdio"],
      ["tracker", "user", "http"],
    ]);
    expect(found.find((s) => s.name === "design")?.definition).toEqual(stdio("design-local"));
  });

  it("falls back to the project root when the session's folder has no servers of its own", () => {
    const names = (folders: string[]) =>
      claudeServersFrom(user, null, folders).map((s) => `${s.name}:${s.scope}`);
    expect(names(["/work/app/wt", "/work/app"])).toContain("db:local");
    expect(names(["/elsewhere"])).toEqual(["design:user", "tracker:user"]);
  });

  it("reads nothing from a missing or malformed config", () => {
    expect(claudeServersFrom(null, "nope", ["/work/app"])).toEqual([]);
    expect(claudeServersFrom({ mcpServers: ["a"], projects: 3 }, {}, ["/work/app"])).toEqual([]);
  });
});
