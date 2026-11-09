import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import type { ActiveAgent } from "../db/queries/agents";
import { listCommanderLog } from "../db/queries/commander-log";
import { listThreads } from "../db/queries/inbox";
import { setJsonSetting } from "../db/queries/settings";
import type { ExegolToolContext } from "../mcp/exegol-protocol";
import { getToolDefsForAccessMode } from "../mcp/exegol-tool-defs";
import { callExegolTool } from "../mcp/exegol-tools";
import { resetAlertGap } from "./alert";
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
      (id) => ({ needsUser: id === "asks", quietMs: 120_000, personMs: null }),
      () => 3,
    );
    expect(project).toMatchObject({ project: "Landing", inbox_waiting: 3 });
    expect(project?.sessions.map((s) => [s.name, s.state, s.quiet_minutes])).toEqual([
      ["asks", "waits_on_person", 2],
      ["busy", "working", 2],
    ]);
  });
});

describe("the Commander's history", () => {
  it("keeps what it changed and what was refused, never its reads or another session's calls", async () => {
    await callExegolTool(
      db,
      "inbox_post",
      { title: "Hero breaks", body: "x", project: "Landing" },
      commander,
    );
    await callExegolTool(db, "inbox_list", {}, commander);
    await callExegolTool(db, "inbox_post", { title: "Mine", body: "x" }, worker);
    await expect(
      callExegolTool(db, "session_suspend", { session: "nope" }, commander),
    ).rejects.toThrow();
    const { actions } = (await callExegolTool(db, "my_history", {}, commander)) as {
      actions: Record<string, unknown>[];
    };
    expect(actions.map((a) => [a.action, a.target, a.outcome])).toEqual([
      ["session_suspend", "nope", "refused"],
      ["inbox_post", "Landing", "done"],
    ]);
    expect(actions[1]?.summary).toBe("Hero breaks");
    expect(listCommanderLog(db, 10)[1]?.ref).toBeTruthy();
  });
});

describe("alert_person", () => {
  it("calls once a minute and is kept in the history", async () => {
    resetAlertGap();
    await callExegolTool(db, "alert_person", { message: "Landing waits on you" }, commander);
    await expect(
      callExegolTool(db, "alert_person", { message: "Again" }, commander),
    ).rejects.toThrow("less than a minute ago");
    expect(listCommanderLog(db, 10).map((e) => [e.action, e.outcome, e.target])).toEqual([
      ["alert_person", "refused", null],
      ["alert_person", "done", null],
    ]);
  });
});
