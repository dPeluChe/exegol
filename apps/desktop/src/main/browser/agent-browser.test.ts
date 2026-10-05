import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { callExegolTool, ExegolToolError } from "../mcp/exegol-tools";
import {
  type BrowserPaneHandle,
  type BrowserToolContext,
  BrowserToolError,
  callBrowserTool,
  resetBrowserWaits,
  setBrowserActionLogger,
  setBrowserHost,
} from "./agent-browser-tools";
import { getPaneControl, handBack, resetBrowserControl, takeOver } from "./control";
import { selectCookiesToCopy, toSetDetails } from "./cookie-migration";
import { LogRing } from "./log-ring";
import { detectNeedsUser } from "./needs-user";
import { actionScript, formatSnapshot, parseKey, parseRef, type RawSnapshot } from "./page-scripts";

const page = (over: Partial<RawSnapshot> = {}): RawSnapshot => ({
  url: "http://localhost:3000/",
  title: "Home",
  text: "Welcome",
  elements: [{ ref: "e1", role: "button", name: "Save", tag: "button" }],
  totalInteractive: 1,
  hasPasswordField: false,
  hasCaptcha: false,
  ...over,
});

/** A login page as the in-page collector reports it */
const LOGIN_FIXTURE = page({
  url: "http://localhost:3000/login",
  title: "Sign in",
  text: "Sign in to continue\nEmail\nPassword",
  elements: [
    { ref: "e1", role: "textbox", name: "Email", tag: "input", type: "email", value: "" },
    { ref: "e2", role: "textbox", name: "Password", tag: "input", type: "password" },
    { ref: "e3", role: "button", name: "Sign in", tag: "button" },
  ],
  totalInteractive: 3,
  hasPasswordField: true,
});

function fakePane(
  paneId: string,
  projectId: string,
  opts: { snapshot?: RawSnapshot; action?: unknown; url?: string } = {},
): BrowserPaneHandle & { scripts: string[]; loaded: string[] } {
  const scripts: string[] = [];
  const loaded: string[] = [];
  let url = opts.url ?? opts.snapshot?.url ?? "http://localhost:3000/";
  return {
    paneId,
    projectId,
    scripts,
    loaded,
    getUrl: () => url,
    getTitle: () => "Home",
    runIsolated: async (code) => {
      scripts.push(code);
      if (code.includes("totalInteractive")) return { ...(opts.snapshot ?? page()), url };
      if (code.includes('{"action":"check-focus"}')) return { ok: true, secret: false };
      return opts.action ?? { ok: true };
    },
    runMain: async () => 42,
    loadUrl: async (u) => {
      loaded.push(u);
      url = u;
    },
    capture: async () => Buffer.from("png"),
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
      livePanes: (projectId) => panes.filter((p) => p.projectId === projectId),
      openPane: async () => {
        throw new BrowserToolError("no window", -32603);
      },
      devServerUrl: async () => "http://localhost:5173",
    });
    setBrowserActionLogger(() => {});
  });

  afterEach(() => {
    db.close();
    resetBrowserControl();
    resetBrowserWaits();
    setBrowserHost(null);
    setBrowserActionLogger(null);
  });

  it("lists only the caller's project panes", async () => {
    const r = (await callBrowserTool(db, "browser_list", {}, ctx())) as {
      panes: { pane: string }[];
    };
    expect(r.panes.map((p) => p.pane)).toEqual(["pane-a"]);
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
      callBrowserTool(db, "browser_click", { pane: "pane-b", ref: "e1" }, ctx()),
    ).rejects.toThrow(/in your project/);
  });

  it("gates write tools by access mode", async () => {
    for (const mode of ["read", "plan"] as const) {
      await expect(
        callBrowserTool(db, "browser_click", { ref: "e1" }, ctx({ accessMode: mode })),
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
    const snap = await callBrowserTool(db, "browser_snapshot", {}, ctx({ accessMode: "read" }));
    expect((snap as { elements: string[] }).elements).toEqual(['e1 button "Save"']);
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
    )) as {
      status: string;
    };
    expect(r.status).toBe("ok");
    expect((panes[0] as ReturnType<typeof fakePane>).loaded).toEqual(["https://example.com/"]);
  });

  it("returns needs_user on a login page and refuses typing a password", async () => {
    panes[0] = fakePane("pane-a", "proj-a", {
      snapshot: LOGIN_FIXTURE,
      action: { error: "password" },
    });
    const snap = (await callBrowserTool(db, "browser_snapshot", {}, ctx())) as {
      needs_user?: { status: string; reason: string };
    };
    expect(snap.needs_user?.status).toBe("needs_user");
    expect(snap.needs_user?.reason).toBe("login");
    expect(getPaneControl("pane-a")?.needsUserHost).toBe("localhost");
    await expect(
      callBrowserTool(db, "browser_type", { ref: "e2", text: "hunter2" }, ctx()),
    ).rejects.toThrow(/never type passwords/);
  });

  it("does not show content of a page outside the allowed hosts", async () => {
    panes[0] = fakePane("pane-a", "proj-a", { url: "https://mail.example.org/inbox" });
    const r = (await callBrowserTool(db, "browser_snapshot", {}, ctx())) as {
      status: string;
      text?: string;
    };
    expect(r.status).toBe("needs_user");
    expect(r.text).toBeUndefined();
    const list = (await callBrowserTool(db, "browser_list", {}, ctx())) as {
      panes: { url: string; title: string | null }[];
    };
    expect(list.panes[0]?.url).toMatch(/outside the allowed hosts/);
    expect(list.panes[0]?.title).toBeNull();
  });

  it("hides log entries logged while the pane was on another site", async () => {
    const pane = panes[0] as ReturnType<typeof fakePane>;
    pane.logs.push({ kind: "console", level: "info", text: "local", page: "localhost" });
    pane.logs.push({ kind: "console", level: "info", text: "secret", page: "mail.example.org" });
    const r = (await callBrowserTool(db, "browser_logs", {}, ctx({ accessMode: "read" }))) as {
      entries: { text: string; page?: string }[];
    };
    expect(r.entries.map((e) => e.text)).toEqual(["local"]);
    expect(r.entries[0]?.page).toBeUndefined();
  });

  it("returns user_has_control after Take over, until Hand back", async () => {
    await callBrowserTool(db, "browser_snapshot", {}, ctx());
    takeOver("pane-a");
    const r = (await callBrowserTool(db, "browser_click", { ref: "e1" }, ctx())) as {
      status: string;
    };
    expect(r.status).toBe("user_has_control");
    handBack("pane-a");
    const ok = (await callBrowserTool(db, "browser_click", { ref: "e1" }, ctx())) as {
      status: string;
    };
    expect(ok.status).toBe("ok");
  });

  it("browser_wait_for_user resolves on hand back", async () => {
    const waiting = callBrowserTool(db, "browser_wait_for_user", { reason: "log in" }, ctx());
    setTimeout(() => handBack("pane-a"), 20);
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

  it("action args are passed as JSON, never as code", async () => {
    await callBrowserTool(db, "browser_type", { ref: "e1", text: '"); alert(1); ("' }, ctx());
    const pane = panes[0] as ReturnType<typeof fakePane>;
    const script = pane.scripts.find((s) => s.includes('"type"')) ?? "";
    expect(script).toContain(
      JSON.stringify({ action: "type", text: '"); alert(1); ("', submit: false, append: false }),
    );
  });
});

describe("page scripts (pure parts)", () => {
  it("accepts only snapshot refs", () => {
    expect(parseRef("e12")).toBe("e12");
    expect(parseRef(" e3 ")).toBe("e3");
    expect(parseRef("e0")).toBeNull();
    expect(parseRef("12")).toBeNull();
    expect(parseRef("e1'); x('")).toBeNull();
    expect(parseRef(12)).toBeNull();
  });

  it("caps the snapshot", () => {
    const many = page({
      text: "x".repeat(100),
      elements: Array.from({ length: 10 }, (_, i) => ({
        ref: `e${i + 1}`,
        role: "link",
        name: `L${i}`,
        tag: "a",
        href: "/x",
      })),
      totalInteractive: 10,
    });
    const s = formatSnapshot(many, { maxElements: 3, maxText: 10 });
    expect(s.elements).toEqual(['e1 link "L0" -> /x', 'e2 link "L1" -> /x', 'e3 link "L2" -> /x']);
    expect(s.text).toBe(`${"x".repeat(10)}…`);
    expect(s.truncated).toBe(true);
  });

  it("formats element state", () => {
    const s = formatSnapshot(
      page({
        elements: [
          {
            ref: "e1",
            role: "checkbox",
            name: "Agree",
            tag: "input",
            type: "checkbox",
            checked: true,
          },
          { ref: "e2", role: "button", name: "Go", tag: "button", disabled: true },
        ],
      }),
    );
    expect(s.elements).toEqual(['e1 checkbox "Agree" [checked]', 'e2 button "Go" [disabled]']);
  });

  it("parses keys", () => {
    expect(parseKey("Enter")).toEqual({ keyCode: "Enter", modifiers: [] });
    expect(parseKey("Shift+Tab")).toEqual({ keyCode: "Tab", modifiers: ["shift"] });
    expect(parseKey("rm -rf")).toBeNull();
  });

  it("builds action scripts with the ref as data", () => {
    expect(actionScript("e5", { action: "click" })).toContain('("e5", {"action":"click"})');
  });
});

describe("needs_user detection", () => {
  it("flags a login form on an allowed host", () => {
    expect(
      detectNeedsUser({ url: LOGIN_FIXTURE.url, hasPasswordField: true, hasCaptcha: false }, [])
        ?.reason,
    ).toBe("login");
  });

  it("flags SSO, captcha, 401/403 and redirects outside the allowlist", () => {
    const base = { hasPasswordField: false, hasCaptcha: false };
    expect(
      detectNeedsUser({ ...base, url: "https://accounts.google.com/o/oauth2/auth" }, [])?.reason,
    ).toBe("sso");
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

describe("cookie migration filter", () => {
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
    { name: "old", value: "3", domain: "localhost", expirationDate: now - 1 },
    { name: "g", value: "4", domain: ".google.com", path: "/" },
  ];

  it("keeps unexpired cookies of local hosts and the allowlist", () => {
    expect(selectCookiesToCopy(cookies, ["*.app.com"], now).map((c) => c.name)).toEqual([
      "sid",
      "s",
    ]);
    expect(selectCookiesToCopy(cookies, [], now).map((c) => c.name)).toEqual(["sid"]);
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
