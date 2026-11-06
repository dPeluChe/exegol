import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { callBrowserTool, forgetBrowserAgent } from "./agent-browser-tools";
import { forgetPane } from "./control";
import type { LoadFailure } from "./load-state";
import { LogRing } from "./log-ring";
import type { RawSnapshot } from "./page-scripts";
import { type BrowserPaneHandle, type BrowserToolContext, setBrowserHost } from "./tool-guards";

const ctx: BrowserToolContext = { agentId: "agent-a", projectId: "proj-a", accessMode: "write" };

const signals = (over: Partial<RawSnapshot> = {}): RawSnapshot => ({
  text: "",
  elements: [],
  more: false,
  offscreen: 0,
  nextOffset: null,
  textLength: 0,
  framesSkipped: 0,
  url: "http://localhost:3000/",
  title: "Home",
  hasPasswordField: false,
  hasCaptcha: false,
  loggedIn: false,
  focusSecret: false,
  mutations: null,
  ...over,
});

interface Scene {
  /** What each read of the page returns, in order; the last repeats */
  reads?: RawSnapshot[];
  action?: unknown;
  wait?: boolean;
  failure?: LoadFailure | null;
  stopped?: boolean;
  http?: number;
  onAction?: (logs: LogRing) => void;
}

function fakePane(scene: Scene) {
  const logs = new LogRing();
  const keys: string[] = [];
  const reads = [...(scene.reads ?? [signals()])];
  const pane: BrowserPaneHandle = {
    paneId: "pane-a",
    projectId: "proj-a",
    getUrl: () => "http://localhost:3000/",
    getTitle: () => "Home",
    runIsolated: async (code) => {
      if (code.includes("return signals();") || code.includes("const elements = []")) {
        return reads.length > 1 ? reads.shift() : reads[0];
      }
      if (code.includes("watchChanges(true);\n})()")) return null;
      scene.onAction?.(logs);
      return scene.action ?? { ok: true };
    },
    runMain: async () => null,
    loadUrl: () => {},
    awaitLoad: async () => !!scene.wait,
    loadState: () => ({ failure: scene.failure ?? null, stopped: !!scene.stopped }),
    capture: async () => Buffer.from(""),
    sendKey: (key) => keys.push(key),
    lastHttpStatus: () => scene.http ?? 200,
    logs,
  };
  return { pane, keys };
}

describe("what an action reports", () => {
  let db: Database.Database;
  const useHost = (pane: BrowserPaneHandle) =>
    setBrowserHost({
      livePanes: () => [pane],
      openPane: async () => pane,
      devServerUrl: async () => null,
    });
  const run = async (
    scene: Scene,
    tool: "browser_click" | "browser_type" | "browser_select",
    args = {},
  ) => {
    const { pane, keys } = fakePane(scene);
    useHost(pane);
    const r = await callBrowserTool(db, tool, { ref: "e1.doc1", ...args }, ctx);
    return { r: r as Record<string, unknown> & { untrusted_page_content: never }, keys };
  };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('proj-a', 'A', '/tmp/a')").run();
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES ('agent-a', 'proj-a', 'claude-code', 't', 'running')",
    ).run();
  });

  afterEach(() => {
    db.close();
    forgetBrowserAgent("agent-a");
    forgetPane("pane-a");
    setBrowserHost(null);
  });

  it("a click the page ignored says so; one it reacted to does not", async () => {
    const ignored = await run({ reads: [signals(), signals({ mutations: 0 })] }, "browser_click");
    expect(ignored.r).toMatchObject({ status: "ok", changed: false });
    expect(ignored.r.hint).toMatch(/did not react/);
    const reacted = await run({ reads: [signals(), signals({ mutations: 3 })] }, "browser_click");
    expect(reacted.r).toMatchObject({ status: "ok", changed: true });
    expect(reacted.r.hint).toBeUndefined();
  });

  it("a new document counts as a change", async () => {
    const { r } = await run({ reads: [signals({ mutations: 0 }), signals()] }, "browser_click");
    expect(r.changed).toBe(true);
  });

  it("reports the errors logged since the action, not older ones", async () => {
    const { r } = await run(
      {
        onAction: (logs) => logs.push({ kind: "exception", level: "error", text: "Uncaught boom" }),
      },
      "browser_click",
    );
    expect(r.untrusted_page_content).toMatchObject({ new_errors: ["Uncaught boom"] });
  });

  it("hides an error from a page outside the project's hosts", async () => {
    const { r } = await run(
      {
        onAction: (logs) =>
          logs.push({ kind: "console", level: "error", text: "secret", page: "bank.example" }),
      },
      "browser_click",
    );
    expect(r.untrusted_page_content).toMatchObject({ new_errors: undefined });
  });

  it("a covered element is reported, with what covers it as page data", async () => {
    const { r } = await run({ action: { error: "obscured", by: "div#modal" } }, "browser_click");
    expect(r.status).toBe("obscured");
    expect(r.untrusted_page_content).toEqual({ covered_by: "div#modal" });
  });

  it("a failed load is reported instead of acting on Chromium's error page", async () => {
    const failure = { error: "ERR_CONNECTION_REFUSED", url: "http://localhost:3000/" };
    const { r } = await run({ failure }, "browser_click");
    expect(r).toMatchObject({ status: "load_failed", error: "ERR_CONNECTION_REFUSED" });
  });

  it("a failed url off the allowed hosts stays out of the result", async () => {
    const failure = { error: "ERR_FAILED", url: "https://bank.example/account/42" };
    const { r } = await run({ failure }, "browser_click");
    expect(r.url).toBe("(outside the allowed hosts: bank.example)");
  });

  it("an action that navigates into a failed load reports that", async () => {
    const scene: Scene = {};
    const failure = { error: "ERR_NAME_NOT_RESOLVED", url: "http://localhost:3000/x" };
    scene.onAction = () => {
      scene.failure = failure;
    };
    const { r } = await run(scene, "browser_click");
    expect(r.status).toBe("load_failed");
  });

  it("a server that has not answered is loading, not a timeout", async () => {
    const scene: Scene = {};
    scene.onAction = () => {
      scene.wait = true;
    };
    const { r } = await run(scene, "browser_click");
    expect(r.status).toBe("loading");
  });

  it("flags a stopped load and an HTTP error", async () => {
    const { r } = await run({ stopped: true, http: 500 }, "browser_click");
    expect(r).toMatchObject({ status: "ok", load_stopped: true, http_status: 500 });
  });

  it("typing into a field with no form presses a real Enter", async () => {
    const { r, keys } = await run({ action: { ok: true, submitted: "enter" } }, "browser_type", {
      text: "hola",
      submit: true,
    });
    expect(keys).toEqual(["Enter"]);
    expect(r.submitted).toBe("enter");
  });

  it("says when the field holds something else than what was typed", async () => {
    const { r, keys } = await run({ action: { ok: true, actual: "12-34" } }, "browser_type", {
      text: "1234",
    });
    expect(keys).toEqual([]);
    expect(r.untrusted_page_content).toMatchObject({ actual_value: "12-34" });
  });

  it("the options of a select stay page data", async () => {
    const { r } = await run({ action: { error: "no_option", options: ["a"] } }, "browser_select", {
      value: "z",
    });
    expect(r.status).toBe("no_option");
    expect(r.untrusted_page_content).toEqual({ options: ["a"] });
  });

  it("a snapshot comes in the action's one read of the page", async () => {
    const { r } = await run({ reads: [signals({ text: "after" })] }, "browser_click", {
      snapshot: true,
    });
    expect(r).toMatchObject({
      status: "ok",
      snapshot: { untrusted_page_content: { text: "after" } },
    });
  });

  it("a paging call sends only what it pages", async () => {
    const { pane } = fakePane({ reads: [signals({ text: "body" })] });
    useHost(pane);
    const content = async (args: Record<string, unknown>) =>
      (
        (await callBrowserTool(db, "browser_snapshot", args, ctx)) as {
          untrusted_page_content: { text: string };
        }
      ).untrusted_page_content;
    expect((await content({})).text).toBe("body");
    expect((await content({ offset: 50 })).text).toBe("");
  });

  it("audits reads too", async () => {
    useHost(fakePane({}).pane);
    await callBrowserTool(db, "browser_snapshot", {}, ctx);
    await callBrowserTool(db, "browser_logs", {}, ctx);
    const rows = db.prepare("SELECT payload FROM agent_events").all() as { payload: string }[];
    expect(rows.map((r) => JSON.parse(r.payload).tool)).toEqual([
      "browser_snapshot",
      "browser_logs",
    ]);
  });
});
