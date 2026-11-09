import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import type { ActiveAgent } from "../db/queries/agents";
import { listThreads } from "../db/queries/inbox";
import { setJsonSetting } from "../db/queries/settings";
import type { ExegolToolContext } from "../mcp/exegol-protocol";
import { getToolDefsForAccessMode } from "../mcp/exegol-tool-defs";
import { callExegolTool } from "../mcp/exegol-tools";
import { fleetView } from "./fleet";
import { isCommander, setCommanderAutonomy } from "./home";

let db: Database.Database;
const commander: ExegolToolContext = { agentId: "cmd", accessMode: "write", projectId: "home" };
const worker: ExegolToolContext = { agentId: "w1", accessMode: "write", projectId: "p1" };

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  for (const [id, name] of [
    ["home", "Commander"],
    ["p1", "Landing"],
  ]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, name, `/x/${id}`);
  }
  for (const [id, project] of [
    ["cmd", "home"],
    ["w1", "p1"],
  ]) {
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES (?, ?, 'claude-code', 't', 'waiting_input')",
    ).run(id, project);
  }
  setJsonSetting(db, "commander_project_id", "home");
});

describe("the Commander's role", () => {
  it("belongs to the session in its project, and only it lists and calls its tools", async () => {
    expect([isCommander(db, commander), isCommander(db, worker)]).toEqual([true, false]);
    const tools = getToolDefsForAccessMode("write", true, true);
    expect(tools.map((t) => t.name)).toContain("fleet_status");
    const post = tools.find((t) => t.name === "inbox_post")?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(post.properties)).toEqual(expect.arrayContaining(["title", "project"]));
    await expect(callExegolTool(db, "fleet_status", {}, worker)).rejects.toThrow("Unknown tool");
  });

  it("acts in the project it names; anyone else's project is ignored", async () => {
    const post = { title: "Hero breaks", body: "On Safari", project: "Landing" };
    await callExegolTool(db, "inbox_post", post, commander);
    const inLanding = () => listThreads(db, { projectId: "p1", state: "active", limit: 10 });
    expect(inLanding()).toHaveLength(1);
    await callExegolTool(db, "inbox_post", { ...post, project: "Commander" }, worker);
    expect(inLanding()).toHaveLength(2);
    await expect(
      callExegolTool(db, "inbox_post", { ...post, project: "Nope" }, commander),
    ).rejects.toThrow("No project named");
  });

  it("set to ask first, writes into no session", async () => {
    setCommanderAutonomy(db, "ask");
    await expect(
      callExegolTool(db, "agent_send", { target: "w1", message: "go" }, commander),
    ).rejects.toThrow("ask first");
  });
});

describe("fleetView", () => {
  it("puts the sessions that need the person first and leaves plain terminals out", () => {
    const agent = (id: string, status: string, cliType = "codex") =>
      ({ id, projectId: "p1", status, cliType, alias: id, taskDescription: "t" }) as ActiveAgent;
    const [project] = fleetView(
      [{ id: "p1", name: "Landing" }],
      [agent("busy", "running"), agent("asks", "running"), agent("sh", "idle", "shell")],
      (id) => ({ needsUser: id === "asks", quietMs: 120_000 }),
      () => 3,
    );
    expect(project).toMatchObject({ project: "Landing", inbox_waiting: 3 });
    expect(project?.sessions.map((s) => [s.name, s.state, s.quiet_minutes])).toEqual([
      ["asks", "waits_on_person", 2],
      ["busy", "working", 2],
    ]);
  });
});
