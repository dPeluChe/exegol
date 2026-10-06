import { runInNewContext } from "node:vm";
import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { callExegolTool } from "../mcp/exegol-tools";
import { callBrowserTool, forgetBrowserAgent } from "./agent-browser-tools";
import {
  forgetPane,
  getPaneControl,
  handBack,
  isAgentActing,
  noteAgentAction,
  takeOver,
  waitForHandBack,
} from "./control";
import { projectsToMigrate, selectCookiesToCopy, toSetDetails } from "./cookie-migration";
import { LogRing } from "./log-ring";
import { detectNeedsUser } from "./needs-user";
import {
  actionScript,
  formatSnapshot,
  guardedEvalScript,
  parseKey,
  parseRef,
  type RawSnapshot,
} from "./page-scripts";
import { blocksAgentRequest, logUrl } from "./request-guard";
import { type BrowserPaneHandle, type BrowserToolContext, setBrowserHost } from "./tool-guards";
import { isWaitStale } from "./tool-handlers";

const page = (over: Partial<RawSnapshot> = {}): RawSnapshot => ({
  url: "http://localhost:3000/",
  title: "Home",
  text: "Welcome",
  elements: [{ ref: "e1.doc1", role: "button", name: "Save", tag: "button" }],
  more: false,
  hasPasswordField: false,
  hasCaptcha: false,
  loggedIn: false,
  focusSecret: false,
  ...over,
});

/** A login page as the in-page collector reports it */
const LOGIN_FIXTURE = page({
  url: "http://localhost:3000/login",
  title: "Sign in",
  text: "Sign in to continue\nEmail\nPassword",
  elements: [
    { ref: "e1.doc1", role: "textbox", name: "Email", tag: "input", type: "email", value: "" },
    { ref: "e2.doc1", role: "textbox", name: "Password", tag: "input", type: "password" },
    { ref: "e3.doc1", role: "button", name: "Sign in", tag: "button" },
  ],
  hasPasswordField: true,
});

function fakePane(
  paneId: string,
  projectId: string,
  opts: { snapshot?: RawSnapshot; action?: unknown; url?: string } = {},
): BrowserPaneHandle & { scripts: string[]; loaded: string[]; evals: string[] } {
  const scripts: string[] = [];
  const loaded: string[] = [];
  const evals: string[] = [];
  let url = opts.url ?? opts.snapshot?.url ?? "http://localhost:3000/";
  return {
    paneId,
    projectId,
    scripts,
    loaded,
    evals,
    getUrl: () => url,
    getTitle: () => "Home",
    runIsolated: async (code: string) => {
      scripts.push(code);
      if (code.includes("const elements = []") || code.includes("return signals();")) {
        return { ...(opts.snapshot ?? page()), url };
      }
      return opts.action ?? { ok: true };
    },
    runMain: async (code: string) => {
      evals.push(code);
      return 42;
    },
    loadUrl: async (u: string) => {
      loaded.push(u);
      url = u;
    },
    capture: async () => Buffer.from("jpeg"),
    sendKey: () => {},
    lastHttpStatus: () => 200,
    logs: new LogRing(),
  };
}

describe("agent browser tools", () => {
  let db: Database.Database;
  let panes: BrowserPaneHandle[];
  const ctx = (over: Partial<BrowserToolContext> = {}): BrowserToolContext => ({
    agentId: "agent-a",
    projectId: "proj-a",
    accessMode: "write",
    ...over,
  });
  const pane = (i = 0) => panes[i] as ReturnType<typeof fakePane>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('proj-a', 'A', '/tmp/a')").run();
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('proj-b', 'B', '/tmp/b')").run();
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES ('agent-a', 'proj-a', 'claude-code', 't', 'running')",
    ).run();
    panes = [fakePane("pane-a", "proj-a"), fakePane("pane-b", "proj-b")];
    // The real host filters by partition; the fake one by project, so the tools' own guard is
    // what is under test when a foreign pane slips into the list
    setBrowserHost({
      livePanes: (projectId: string) => panes.filter((p) => p.projectId === projectId),
      openPane: async () => {
        const opened = fakePane("pane-new", "proj-a");
        panes.push(opened);
        return opened;
      },
      devServerUrl: async () => "http://localhost:5173",
    });
  });

  afterEach(() => {
    db.close();
    forgetBrowserAgent("agent-a");
    for (const id of ["pane-a", "pane-b", "pane-new"]) forgetPane(id);
    setBrowserHost(null);
  });

  it("lists only the caller's project panes", async () => {
    const r = (await callBrowserTool(db, "browser_list", {}, ctx())) as {
      panes: { pane: string }[];
      allowedHosts: string[];
    };
    expect(r.panes.map((p) => p.pane)).toEqual(["pane-a"]);
    expect(r.allowedHosts).not.toContain("*.local");
  });

  it("refuses another project's pane id, with the same error as a missing one", async () => {
    const other = callBrowserTool(db, "browser_snapshot", { pane: "pane-b" }, ctx());
    await expect(other).rejects.toThrow(/No live browser pane "pane-b" in your project/);
    const missing = callBrowserTool(db, "browser_snapshot", { pane: "nope" }, ctx());
    await expect(missing).rejects.toThrow(/No live browser pane "nope" in your project/);
  });

  it("never resolves a foreign pane even if the host lists it", async () => {
    setBrowserHost({
      livePanes: () => panes,
      openPane: async () => panes[1] as BrowserPaneHandle,
      devServerUrl: async () => null,
    });
    await expect(
      callBrowserTool(db, "browser_click", { pane: "pane-b", ref: "e1.doc1" }, ctx()),
    ).rejects.toThrow(/in your project/);
  });

  it("gates write tools by access mode", async () => {
    for (const mode of ["read", "plan"] as const) {
      await expect(
        callExegolTool(db, "browser_click", { ref: "e1.doc1" }, ctx({ accessMode: mode })),
      ).rejects.toThrow(/requires write access/);
      await expect(
        callExegolTool(
          db,
          "browser_navigate",
          { url: "http://localhost:1" },
          ctx({ accessMode: mode }),
        ),
      ).rejects.toBeInstanceOf(ExegolToolError);
    }
    const snap = (await callBrowserTool(
      db,
      "browser_snapshot",
      {},
      ctx({ accessMode: "read" }),
    )) as {
      untrusted_page_content: { elements: string[]; title: string };
    };
    expect(snap.untrusted_page_content.elements).toEqual(['e1.doc1 button "Save"']);
    expect(snap.untrusted_page_content.title).toBe("Home");
  });

  it("browser_open in read mode opens a new pane and never navigates an existing one", async () => {
    const r = (await callBrowserTool(
      db,
      "browser_open",
      { url: "http://localhost:3000/x" },
      ctx({ accessMode: "read" }),
    )) as { pane: string };
    expect(r.pane).toBe("pane-new");
    expect(pane(0).loaded).toEqual([]);
    await expect(
      callBrowserTool(
        db,
        "browser_open",
        { url: "http://localhost:3000/x", pane: "pane-a" },
        ctx({ accessMode: "read" }),
      ),
    ).rejects.toThrow(/only opens a new pane/);
    const w = (await callBrowserTool(db, "browser_open", { url: "localhost:3000/y" }, ctx())) as {
      pane: string;
    };
    expect(["pane-a", "pane-new"]).toContain(w.pane);
  });

  it("refuses URLs outside the policy and allows the project's allowlist", async () => {
    await expect(
      callBrowserTool(db, "browser_navigate", { url: "https://example.com" }, ctx()),
    ).rejects.toThrow(/not allowed/);
    await expect(
      callBrowserTool(db, "browser_navigate", { url: "javascript:alert(1)" }, ctx()),
    ).rejects.toThrow(/blocked/);
    db.prepare("UPDATE projects SET browser_hosts = ? WHERE id = 'proj-a'").run(
      JSON.stringify(["example.com"]),
    );
    const r = (await callBrowserTool(
      db,
      "browser_navigate",
      { url: "https://example.com" },
      ctx(),
    )) as { status: string };
    expect(r.status).toBe("ok");
    expect(pane(0).loaded).toEqual(["https://example.com/"]);
  });

  it("returns needs_user on a login page and refuses typing a password", async () => {
    panes[0] = fakePane("pane-a", "proj-a", {
      snapshot: LOGIN_FIXTURE,
      action: { error: "password" },
    });
    const snap = (await callBrowserTool(db, "browser_snapshot", {}, ctx())) as {
      needs_user?: { status: string; reason: string; hint: string };
    };
    expect(snap.needs_user?.status).toBe("needs_user");
    expect(snap.needs_user?.reason).toBe("login");
    expect(snap.needs_user?.hint).toMatch(/login page at localhost.*"log in at localhost"/);
    expect(getPaneControl("pane-a")?.needsUser).toEqual({ host: "localhost", kind: "login" });
    await expect(
      callBrowserTool(db, "browser_type", { ref: "e2.doc1", text: "hunter2" }, ctx()),
    ).rejects.toThrow(/never type passwords/);
  });

  it("does not show content of a page outside the allowed hosts", async () => {
    panes[0] = fakePane("pane-a", "proj-a", { url: "https://mail.example.org/inbox" });
    const r = (await callBrowserTool(db, "browser_snapshot", {}, ctx())) as {
      status: string;
      untrusted_page_content?: unknown;
    };
    expect(r.status).toBe("needs_user");
    expect(r.untrusted_page_content).toBeUndefined();
    const list = (await callBrowserTool(db, "browser_list", {}, ctx())) as {
      panes: { url: string; untrusted_page_content: { title: string | null } }[];
    };
    expect(list.panes[0]?.url).toMatch(/outside the allowed hosts/);
    expect(list.panes[0]?.untrusted_page_content.title).toBeNull();
  });

  it("hides log entries logged while the pane was on another site", async () => {
    pane(0).logs.push({ kind: "console", level: "info", text: "local", page: "localhost" });
    pane(0).logs.push({ kind: "console", level: "info", text: "secret", page: "mail.example.org" });
    const r = (await callBrowserTool(db, "browser_logs", {}, ctx({ accessMode: "read" }))) as {
      untrusted_page_content: { entries: { text: string; page?: string }[] };
    };
    expect(r.untrusted_page_content.entries.map((e) => e.text)).toEqual(["local"]);
    expect(r.untrusted_page_content.entries[0]?.page).toBeUndefined();
  });

  it("browser_eval is off until the project allows it, and runs behind the host guard", async () => {
    await expect(callBrowserTool(db, "browser_eval", { js: "1" }, ctx())).rejects.toThrow(
      /browser_eval is off/,
    );
    db.prepare("UPDATE projects SET browser_eval = 1 WHERE id = 'proj-a'").run();
    const r = (await callBrowserTool(db, "browser_eval", { js: "document.title" }, ctx())) as {
      untrusted_page_content: { result: string };
    };
    expect(r.untrusted_page_content.result).toBe("42");
    expect(pane(0).evals[0]).toContain('location.host !== "localhost:3000"');
  });

  it("returns user_has_control after Take over, until Hand back", async () => {
    await callBrowserTool(db, "browser_snapshot", {}, ctx());
    takeOver("pane-a");
    const r = (await callBrowserTool(db, "browser_click", { ref: "e1.doc1" }, ctx())) as {
      status: string;
    };
    expect(r.status).toBe("user_has_control");
    expect(handBack("pane-a")).toEqual({ agentId: "agent-a", woke: false });
    const ok = (await callBrowserTool(db, "browser_click", { ref: "e1.doc1" }, ctx())) as {
      status: string;
    };
    expect(ok.status).toBe("ok");
  });

  it("browser_wait_for_user resolves on hand back", async () => {
    const waiting = callBrowserTool(db, "browser_wait_for_user", { reason: "log in" }, ctx());
    setTimeout(() => expect(handBack("pane-a")?.woke).toBe(true), 20);
    const r = (await waiting) as { status: string };
    expect(r.status).toBe("handed_back");
    expect(getPaneControl("pane-a")?.waiting).toBeNull();
  });

  it("a hand back between two polls still counts", async () => {
    const first = callBrowserTool(db, "browser_wait_for_user", { reason: "log in" }, ctx());
    setTimeout(() => handBack("pane-a"), 10);
    await first;
    // A second, fresh wait starts over instead of returning the old hand back
    const second = callBrowserTool(db, "browser_wait_for_user", { reason: "again" }, ctx());
    setTimeout(() => handBack("pane-a"), 10);
    expect(((await second) as { status: string }).status).toBe("handed_back");
  });

  it("a closed pane wakes its waiter with pane_closed", async () => {
    const waiting = callBrowserTool(db, "browser_wait_for_user", { reason: "log in" }, ctx());
    setTimeout(() => forgetPane("pane-a"), 10);
    expect(((await waiting) as { status: string }).status).toBe("pane_closed");
    expect(getPaneControl("pane-a")).toBeUndefined();
  });

  it("an agent's exit clears its wait and its needs-user flag", async () => {
    panes[0] = fakePane("pane-a", "proj-a", { snapshot: LOGIN_FIXTURE });
    await callBrowserTool(db, "browser_snapshot", {}, ctx());
    expect(getPaneControl("pane-a")?.needsUser).not.toBeNull();
    forgetBrowserAgent("agent-a");
    expect(getPaneControl("pane-a")?.needsUser).toBeNull();
  });

  it("action args are passed as JSON, never as code", async () => {
    await callBrowserTool(db, "browser_type", { ref: "e1.doc1", text: '"); alert(1); ("' }, ctx());
    const script = pane(0).scripts.find((s) => s.includes('"type"')) ?? "";
    expect(script).toContain(
      JSON.stringify({ action: "type", text: '"); alert(1); ("', submit: false, append: false }),
    );
  });
});

/** Runs an in-page script against a stand-in page: only what the guards touch */
function runInPage(
  code: string,
  host: string,
  state?: { doc: string; refs: Map<string, unknown> },
) {
  return runInNewContext(code, { location: { host }, __exegol: state });
}

describe("page scripts", () => {
  it("accepts only snapshot refs with their document id", () => {
    expect(parseRef("e12.k3x9")).toBe("e12.k3x9");
    expect(parseRef(" e3.abcd ")).toBe("e3.abcd");
    expect(parseRef("e12")).toBeNull();
    expect(parseRef("e0.abcd")).toBeNull();
    expect(parseRef("e1.abcd'); x('")).toBeNull();
    expect(parseRef(12)).toBeNull();
  });

  it("a ref from another document is stale, not a different element", () => {
    const state = { doc: "new1", refs: new Map() };
    const r = runInPage(
      actionScript("e1.old1", { action: "click" }, "localhost:3000"),
      "localhost:3000",
      state,
    );
    expect(r).toEqual({ error: "stale_ref" });
  });

  it("throws in the page when it is no longer on the host inspect checked", () => {
    expect(() =>
      runInPage(actionScript("e1.abcd", { action: "click" }, "localhost:3000"), "evil.com"),
    ).toThrow(/exegol:page_changed/);
    expect(() => runInPage(guardedEvalScript("1 + 1", "localhost:3000"), "evil.com")).toThrow(
      /exegol:page_changed/,
    );
    expect(runInPage(guardedEvalScript("1 + 1", "localhost:3000"), "localhost:3000")).toBe(2);
  });

  it("caps the snapshot", () => {
    const many = page({
      text: "x".repeat(100),
      elements: Array.from({ length: 10 }, (_, i) => ({
        ref: `e${i + 1}.doc1`,
        role: "link",
        name: `L${i}`,
        tag: "a",
        href: "/x",
      })),
    });
    const s = formatSnapshot(many, { maxElements: 3, maxText: 10 });
    expect(s.elements).toEqual([
      'e1.doc1 link "L0" -> /x',
      'e2.doc1 link "L1" -> /x',
      'e3.doc1 link "L2" -> /x',
    ]);
    expect(s.text).toBe(`${"x".repeat(10)}…`);
    expect(s.truncated).toBe(true);
    expect(formatSnapshot(page({ more: true })).truncated).toBe(true);
  });

  it("formats element state", () => {
    const s = formatSnapshot(
      page({
        elements: [
          {
            ref: "e1.doc1",
            role: "checkbox",
            name: "Agree",
            tag: "input",
            type: "checkbox",
            checked: true,
          },
          { ref: "e2.doc1", role: "button", name: "Go", tag: "button", disabled: true },
        ],
      }),
    );
    expect(s.elements).toEqual([
      'e1.doc1 checkbox "Agree" [checked]',
      'e2.doc1 button "Go" [disabled]',
    ]);
  });

  it("parses keys", () => {
    expect(parseKey("Enter")).toEqual({ keyCode: "Enter", modifiers: [] });
    expect(parseKey("Shift+Tab")).toEqual({ keyCode: "Tab", modifiers: ["shift"] });
    expect(parseKey("rm -rf")).toBeNull();
  });
});

describe("needs_user detection", () => {
  const base = { hasPasswordField: false, hasCaptcha: false };

  it("flags a login page on an allowed host", () => {
    expect(
      detectNeedsUser({ url: LOGIN_FIXTURE.url, hasPasswordField: true, hasCaptcha: false }, [])
        ?.reason,
    ).toBe("login");
    expect(detectNeedsUser({ ...base, url: "http://localhost:3000/sign-in" }, [])?.reason).toBe(
      "login",
    );
  });

  it("does not flag a password field on a page the user is logged into", () => {
    expect(
      detectNeedsUser(
        {
          url: "http://localhost:3000/settings",
          hasPasswordField: true,
          hasCaptcha: false,
          loggedIn: true,
        },
        [],
      ),
    ).toBeNull();
  });

  it("flags SSO, captcha, 401/403 and redirects outside the allowlist", () => {
    expect(
      detectNeedsUser({ ...base, url: "https://accounts.google.com/o/oauth2/auth" }, [])?.reason,
    ).toBe("sso");
    expect(detectNeedsUser({ ...base, url: "https://acme.okta.com/x" }, [])?.reason).toBe("sso");
    expect(
      detectNeedsUser({ ...base, url: "http://localhost:3000", hasCaptcha: true }, [])?.reason,
    ).toBe("captcha");
    expect(
      detectNeedsUser({ ...base, url: "http://localhost:3000/a", httpStatus: 401 }, [])?.reason,
    ).toBe("http_401");
    expect(
      detectNeedsUser({ ...base, url: "http://localhost:3000/a", httpStatus: 403 }, [])?.reason,
    ).toBe("http_403");
    expect(detectNeedsUser({ ...base, url: "https://idp.corp.com/x" }, [])?.reason).toBe(
      "outside_allowlist",
    );
    expect(detectNeedsUser({ ...base, url: "http://localhost:3000/dashboard" }, [])).toBeNull();
  });
});

describe("network guard while an agent drives", () => {
  afterEach(() => forgetPane("p1"));

  it("blocks requests outside local and the allowlist only while the agent acts", () => {
    expect(blocksAgentRequest("https://evil.com/x?d=secret", true, [])).toBe(true);
    expect(blocksAgentRequest("wss://evil.com/s", true, [])).toBe(true);
    expect(blocksAgentRequest("https://evil.com/x", false, [])).toBe(false);
    expect(blocksAgentRequest("http://localhost:3000/api", true, [])).toBe(false);
    expect(blocksAgentRequest("https://api.app.com/v1", true, ["*.app.com"])).toBe(false);
    expect(blocksAgentRequest("data:image/png;base64,AA", true, [])).toBe(false);
  });

  it("acting means a recent action with the pane not handed to the user", () => {
    expect(isAgentActing("p1")).toBe(false);
    noteAgentAction("p1", "proj", { id: "a1", alias: null });
    expect(isAgentActing("p1")).toBe(true);
    expect(isAgentActing("p1", Date.now() + 60_000)).toBe(false);
    takeOver("p1");
    expect(isAgentActing("p1")).toBe(false);
    handBack("p1");
    noteAgentAction("p1", "proj", { id: "a1", alias: null });
    expect(isAgentActing("p1")).toBe(true);
  });

  it("strips another site's query and fragment from logged URLs", () => {
    expect(logUrl("https://cdn.x.com/a.js?token=1#f", "localhost")).toBe("https://cdn.x.com/a.js");
    expect(logUrl("http://localhost:3000/api?q=1", "localhost")).toBe(
      "http://localhost:3000/api?q=1",
    );
    expect(logUrl("https://x.com/a?b", null)).toBe("https://x.com/a");
  });
});

describe("browser_wait_for_user refresh rules", () => {
  const now = 1_000_000;
  const wait = {
    paneId: "p",
    reason: "log in",
    handBacks: 0,
    deadline: now + 60_000,
    lastPollAt: now,
  };

  it("continues the same ask while it is polled and in time", () => {
    expect(isWaitStale(wait, { paneId: "p", reason: "log in", now: now + 25_000 })).toBe(false);
  });

  it("starts fresh on a new reason, another pane, a passed deadline or an abandoned poll", () => {
    expect(isWaitStale(undefined, { paneId: "p", reason: "log in", now })).toBe(true);
    expect(isWaitStale(wait, { paneId: "p", reason: "seed data", now })).toBe(true);
    expect(isWaitStale(wait, { paneId: "q", reason: "log in", now })).toBe(true);
    expect(isWaitStale(wait, { paneId: "p", reason: "log in", now: now + 60_000 })).toBe(true);
    expect(isWaitStale(wait, { paneId: "p", reason: "log in", now: now + 31_000 })).toBe(true);
  });

  it("wakes a waiter on hand back and reports a timeout otherwise", async () => {
    noteAgentAction("p2", "proj", { id: "a", alias: null });
    const w = waitForHandBack("p2", 1_000);
    handBack("p2");
    expect(await w).toBe("handed_back");
    expect(await waitForHandBack("p2", 5)).toBe("timeout");
    forgetPane("p2");
  });
});

describe("log ring", () => {
  it("keeps the last N entries and filters by level and seq", () => {
    const ring = new LogRing(3);
    ring.push({ kind: "console", level: "info", text: "a" });
    ring.push({ kind: "console", level: "error", text: "b" });
    ring.push({ kind: "network", level: "warning", text: "c" });
    ring.push({ kind: "console", level: "debug", text: "d" });
    expect(ring.size).toBe(3);
    expect(ring.query().entries.map((e) => e.text)).toEqual(["b", "c", "d"]);
    expect(ring.query({ level: "warning" }).entries.map((e) => e.text)).toEqual(["b", "c"]);
    const { lastSeq } = ring.query();
    ring.push({ kind: "console", level: "info", text: "e" });
    expect(ring.query({ since: lastSeq }).entries.map((e) => e.text)).toEqual(["e"]);
    expect(ring.query({ since: 1 }).dropped).toBe(true);
  });

  it("truncates long messages", () => {
    const ring = new LogRing();
    ring.push({ kind: "console", level: "info", text: "x".repeat(5_000) });
    expect(ring.query().entries[0]?.text.length).toBeLessThan(2_100);
  });
});

describe("cookie copy", () => {
  const now = 1_000_000;
  const cookies = [
    { name: "sid", value: "1", domain: "localhost", hostOnly: true, path: "/", httpOnly: true },
    {
      name: "s",
      value: "2",
      domain: ".staging.app.com",
      path: "/",
      secure: true,
      expirationDate: now + 10,
      sameSite: "lax" as const,
    },
    { name: "parent", value: "p", domain: ".app.com", path: "/" },
    { name: "old", value: "3", domain: "localhost", expirationDate: now - 1 },
    { name: "g", value: "4", domain: ".google.com", path: "/" },
  ];
  const names = (scope: { local: boolean; hosts: string[] }) =>
    selectCookiesToCopy(cookies, scope, now).map((c) => c.name);

  it("the upgrade copy takes local hosts and the allowlist, unexpired", () => {
    expect(names({ local: true, hosts: ["*.app.com"] })).toEqual(["sid", "s", "parent"]);
    expect(names({ local: true, hosts: [] })).toEqual(["sid"]);
  });

  it("a host added later brings its own and its parent domain's cookies, never localhost's", () => {
    expect(names({ local: false, hosts: ["staging.app.com"] })).toEqual(["s", "parent"]);
    expect(names({ local: false, hosts: [] })).toEqual([]);
  });

  it("the upgrade runs once, only for projects that existed before it", () => {
    expect(projectsToMigrate(["a", "b"], { done: false, migrated: ["b"] })).toEqual(["a"]);
    expect(projectsToMigrate(["a", "b"], { done: true, migrated: [] })).toEqual([]);
  });

  it("recreates each cookie with its flags", () => {
    expect(toSetDetails(cookies[0] as (typeof cookies)[0])).toEqual({
      url: "http://localhost/",
      name: "sid",
      value: "1",
      path: "/",
      secure: false,
      httpOnly: true,
    });
    expect(toSetDetails(cookies[1] as (typeof cookies)[1])).toEqual({
      url: "https://staging.app.com/",
      name: "s",
      value: "2",
      domain: ".staging.app.com",
      path: "/",
      secure: true,
      httpOnly: false,
      expirationDate: now + 10,
      sameSite: "lax",
    });
  });
});
