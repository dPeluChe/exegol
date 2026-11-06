import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { callBrowserTool, forgetBrowserAgent } from "./agent-browser-tools";
import {
  forgetPane,
  handBack,
  heldByOther,
  isAgentActing,
  noteAgentAction,
  noteAgentRead,
  noteUserGesture,
  setNeedsUser,
  takeOver,
} from "./control";
import { fakePane } from "./fake-pane";
import { type BrowserToolContext, setBrowserHost } from "./tool-guards";

const ctx = (agentId: string): BrowserToolContext => ({
  agentId,
  projectId: "proj-a",
  accessMode: "write",
});

describe("who may use a pane", () => {
  let db: Database.Database;
  let panes: ReturnType<typeof fakePane>[];
  let closed: string[];
  const IDS = ["pane-a", "pane-new"];
  const URL_ARG = { url: "http://localhost:3000/next" };
  const run = (agent: string, tool: Parameters<typeof callBrowserTool>[1], args = {}) =>
    callBrowserTool(db, tool, args, ctx(agent)) as Promise<Record<string, unknown>>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('proj-a', 'A', '/tmp/a')").run();
    for (const id of ["agent-a", "agent-b"]) {
      db.prepare(
        "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES (?, 'proj-a', 'claude-code', 't', 'running')",
      ).run(id);
    }
    panes = [fakePane("pane-a", "proj-a")];
    closed = [];
    setBrowserHost({
      livePanes: () => panes,
      openPane: async () => {
        const opened = fakePane("pane-new", "proj-a");
        panes.push(opened);
        return opened;
      },
      devServerUrl: async () => null,
      closePane: (id) => {
        closed.push(id);
        return true;
      },
    });
  });

  afterEach(() => {
    db.close();
    for (const id of ["agent-a", "agent-b"]) forgetBrowserAgent(id);
    for (const id of IDS) forgetPane(id);
    setBrowserHost(null);
  });

  it("another agent can read a driven pane without taking it, but not act on it", async () => {
    await run("agent-a", "browser_navigate", URL_ARG);
    expect((await run("agent-b", "browser_snapshot")).url).toBeDefined();
    expect(heldByOther("pane-a", "agent-b")).not.toBeNull();
    expect(await run("agent-b", "browser_click", { ref: "e1.doc1" })).toMatchObject({
      status: "pane_busy",
    });
    expect((await run("agent-a", "browser_navigate", URL_ARG)).status).toBe("ok");
  });

  it("the hold ends with the lease, or with the agent", () => {
    noteAgentAction("pane-a", "proj-a", { id: "agent-a", alias: "lupus" });
    expect(heldByOther("pane-a", "agent-b")).toBe("lupus");
    expect(heldByOther("pane-a", "agent-a")).toBeNull();
    expect(heldByOther("pane-a", "agent-b", Date.now() + 61_000)).toBeNull();
    forgetBrowserAgent("agent-a");
    expect(heldByOther("pane-a", "agent-b")).toBeNull();
  });

  it("browser_open never loads over a pane nobody named", async () => {
    const opened = await run("agent-b", "browser_open", URL_ARG);
    expect(opened.pane).toBe("pane-new");
    expect(panes[0]?.loaded).toEqual([]);
  });

  it("reading a pane does not make it yours: browser_open still leaves it alone", async () => {
    await run("agent-b", "browser_snapshot");
    expect((await run("agent-b", "browser_open", URL_ARG)).pane).toBe("pane-new");
    expect(panes[0]?.loaded).toEqual([]);
  });

  it("a driver that only reads keeps its pane", async () => {
    await run("agent-a", "browser_navigate", URL_ARG);
    const expired = Date.now() + 61_000;
    expect(heldByOther("pane-a", "agent-b", expired)).toBeNull();
    await run("agent-a", "browser_snapshot");
    expect(heldByOther("pane-a", "agent-b", Date.now() + 59_000)).toBe("agent-a");
  });

  it("browser_open reuses the agent's own pane, and a named one unless it is held", async () => {
    await run("agent-a", "browser_navigate", URL_ARG);
    expect((await run("agent-a", "browser_open", URL_ARG)).pane).toBe("pane-a");
    expect(await run("agent-b", "browser_open", { ...URL_ARG, pane: "pane-a" })).toMatchObject({
      status: "pane_busy",
    });
  });

  it("while the user has control, reads work and actions wait", async () => {
    await run("agent-a", "browser_navigate", URL_ARG);
    takeOver("pane-a");
    expect((await run("agent-a", "browser_snapshot")).status).not.toBe("user_has_control");
    expect((await run("agent-a", "browser_logs")).status).not.toBe("user_has_control");
    expect((await run("agent-a", "browser_navigate", URL_ARG)).status).toBe("user_has_control");
    handBack("pane-a");
  });

  it("an agent closes only the panes it opened", async () => {
    expect((await run("agent-a", "browser_close", { pane: "pane-a" })).status).toBe("not_yours");
    const { pane } = await run("agent-a", "browser_open", { ...URL_ARG, new_pane: true });
    expect((await run("agent-b", "browser_close", { pane })).status).toBe("not_yours");
    expect((await run("agent-a", "browser_close", { pane })).status).toBe("closed");
    expect(closed).toEqual([pane]);
  });

  it("a page that looks like a login keeps the guard until the user touches it", () => {
    noteAgentAction("pane-a", "proj-a", { id: "agent-a", alias: null });
    setNeedsUser("pane-a", "proj-a", { host: "localhost", kind: "login" });
    expect(isAgentActing("pane-a")).toBe(true);
    noteUserGesture("pane-a");
    expect(isAgentActing("pane-a")).toBe(false);
    noteAgentRead("pane-a", "proj-a", "agent-a");
    expect(isAgentActing("pane-a")).toBe(false);
  });
});
