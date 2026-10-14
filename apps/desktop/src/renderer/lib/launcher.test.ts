import { describe, expect, it } from "vitest";
import { defaultModelLabel, sessionNameDisplay } from "./launch-form";
import {
  commandBadge,
  folderFilterKeys,
  type LauncherAction,
  launcherActions,
  launcherFocusAllowed,
  launcherFolder,
  launcherKeyAction,
  launchFormKey,
  matchFolders,
  orderedCommands,
  pinKey,
  quickRepoFolders,
} from "./launcher";
import { sessionsInFolder } from "./launcher-sessions";

const folders = [{ rel: "" }, { rel: "api" }, { rel: "apps/web" }];

describe("launcherFolder", () => {
  it("opens at the project root, not a pinned command's folder", () => {
    expect(launcherFolder(folders, undefined)?.rel).toBe("");
  });
  it("keeps the pane's folder while it exists", () => {
    expect(launcherFolder(folders, "apps/web")?.rel).toBe("apps/web");
    expect(launcherFolder(folders, "gone")?.rel).toBe("");
  });
  it("nothing detected yet, nothing picked", () => {
    expect(launcherFolder([], "api")).toBeUndefined();
  });
});

describe("matchFolders", () => {
  it("filters by folder name, the root as root", () => {
    expect(matchFolders(folders, " WEB ").map((f) => f.rel)).toEqual(["apps/web"]);
    expect(matchFolders(folders, "root").map((f) => f.rel)).toEqual([""]);
    expect(matchFolders(folders, "")).toHaveLength(3);
  });
});

describe("launcherActions", () => {
  it("Git at the root or in a repo, Editor only when installed", () => {
    expect(launcherActions({ atRoot: true, git: false, editor: true })).toEqual([
      "terminal",
      "files",
      "git",
      "browser",
      "finder",
      "editor",
    ]);
    expect(launcherActions({ atRoot: false, git: false, editor: false })).toEqual([
      "terminal",
      "files",
      "browser",
      "finder",
    ]);
  });
});

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    code: /^[0-9]$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...mods,
  }) as KeyboardEvent;

describe("launcherKeyAction", () => {
  const all: LauncherAction[] = ["terminal", "files", "git", "browser", "finder", "editor"];
  const counts = (agents: number, commands = 0, actions = all) => ({ actions, agents, commands });
  it("1-9 pick agents in grid order, within the grid, on every OS", () => {
    for (const mac of [true, false]) {
      expect(launcherKeyAction(key("1"), false, counts(3), mac)).toEqual({ agentIndex: 0 });
      expect(launcherKeyAction(key("3"), false, counts(3), mac)).toEqual({ agentIndex: 2 });
      expect(launcherKeyAction(key("4"), false, counts(3), mac)).toBeNull();
      expect(launcherKeyAction(key("0"), false, counts(3), mac)).toBeNull();
    }
  });
  it("letters open the pane's views, only those offered", () => {
    expect(launcherKeyAction(key("T"), false, counts(0))).toEqual({ action: "terminal" });
    expect(launcherKeyAction(key("o"), false, counts(0), false)).toEqual({ action: "finder" });
    expect(launcherKeyAction(key("e"), false, counts(0, 0, ["terminal"]))).toBeNull();
    expect(launcherKeyAction(key("s"), false, counts(0))).toBeNull();
  });
  it("Option+1..9 (Alt off macOS) run the folder's commands, read from e.code", () => {
    for (const mac of [true, false]) {
      // macOS Option+1 types "¡": the code is what counts
      const opt1 = key("¡", { altKey: true, code: "Digit1" });
      expect(launcherKeyAction(opt1, false, counts(9, 2), mac)).toEqual({ commandIndex: 0 });
      const opt3 = key("£", { altKey: true, code: "Digit3" });
      expect(launcherKeyAction(opt3, false, counts(9, 2), mac)).toBeNull();
    }
  });
  it("never Ctrl+digit (Spaces on macOS), AltGr (Ctrl+Alt) or Cmd+Option", () => {
    const d1 = { code: "Digit1" };
    expect(launcherKeyAction(key("1", { ctrlKey: true, ...d1 }), false, counts(9, 9))).toBeNull();
    expect(
      launcherKeyAction(
        key("1", { ctrlKey: true, altKey: true, ...d1 }),
        false,
        counts(9, 9),
        false,
      ),
    ).toBeNull();
    expect(
      launcherKeyAction(key("1", { metaKey: true, altKey: true, ...d1 }), false, counts(9, 9)),
    ).toBeNull();
  });
  it("/ everywhere; Cmd+F on macOS, Ctrl+F elsewhere opens the folder filter", () => {
    expect(launcherKeyAction(key("/"), false, counts(0), false)).toEqual({ folder: true });
    expect(launcherKeyAction(key("f", { metaKey: true }), false, counts(0), true)).toEqual({
      folder: true,
    });
    expect(launcherKeyAction(key("f", { ctrlKey: true }), false, counts(0), true)).toBeNull();
    expect(launcherKeyAction(key("f", { ctrlKey: true }), false, counts(0), false)).toEqual({
      folder: true,
    });
    expect(launcherKeyAction(key("f", { metaKey: true }), false, counts(0), false)).toBeNull();
  });
  it("never while typing, on a repeat, with Alt on a letter or another chord", () => {
    expect(launcherKeyAction(key("t"), true, counts(0))).toBeNull();
    expect(launcherKeyAction(key("1", { repeat: true }), false, counts(3))).toBeNull();
    expect(launcherKeyAction(key("t", { altKey: true }), false, counts(0))).toBeNull();
    expect(launcherKeyAction(key("t", { metaKey: true }), false, counts(0))).toBeNull();
    expect(
      launcherKeyAction(key("f", { metaKey: true, shiftKey: true }), false, counts(0), true),
    ).toBeNull();
  });
});

describe("commandBadge and the folder chord", () => {
  it("renders per platform", () => {
    expect(commandBadge(1, true)).toBe("⌥1");
    expect(commandBadge(1, false)).toBe("Alt+1");
    expect(folderFilterKeys(true)).toBe("Cmd+F");
    expect(folderFilterKeys(false)).toBe("Ctrl+F");
  });
});

describe("orderedCommands", () => {
  it("pinned first, then as detected", () => {
    const scripts = [{ command: "dev" }, { command: "build" }, { command: "test" }];
    const order = orderedCommands(scripts, [pinKey("web", "test")], "web").map((s) => s.command);
    expect(order).toEqual(["test", "dev", "build"]);
    expect(orderedCommands(scripts, [pinKey("api", "test")], "web")[0]?.command).toBe("dev");
  });
});

describe("launcherFocusAllowed", () => {
  const body = { tagName: "BODY", closest: () => null };
  const inside = new Set<unknown>();
  const container = { contains: (n: never) => inside.has(n) };
  const el = (tagName: string, extra: Record<string, unknown> = {}) => {
    const e = { tagName, closest: () => null, ...extra };
    inside.add(e);
    return e;
  };
  const ctx = { body, launcher: container, pane: container };
  it("body and the launcher's buttons let the keys through", () => {
    expect(launcherFocusAllowed(body, ctx)).toBe(true);
    expect(launcherFocusAllowed(el("BUTTON"), ctx)).toBe(true);
  });
  it("a text field, even the launcher's own filter, takes its typing", () => {
    expect(launcherFocusAllowed(el("INPUT", { type: "text" }), ctx)).toBe(false);
    expect(launcherFocusAllowed(el("TEXTAREA"), ctx)).toBe(false);
  });
  it("focus in another pane keeps the keys there", () => {
    expect(launcherFocusAllowed({ tagName: "DIV", closest: () => null }, ctx)).toBe(false);
  });
});

describe("launchFormKey", () => {
  const ev = (k: string, mods: Partial<KeyboardEvent> = {}) =>
    ({ ...key(k), isComposing: false, ...mods }) as KeyboardEvent;
  it("Esc goes back, Enter and Cmd+Enter launch, Shift+Enter is a new line", () => {
    expect(launchFormKey(ev("Escape"), "TEXTAREA")).toBe("back");
    expect(launchFormKey(ev("Enter"), "TEXTAREA")).toBe("launch");
    expect(launchFormKey(ev("Enter", { shiftKey: true }), "TEXTAREA")).toBeNull();
  });
  it("Cmd+Enter on macOS, Ctrl+Enter elsewhere launches from anywhere", () => {
    expect(launchFormKey(ev("Enter", { metaKey: true }), "BUTTON", true)).toBe("launch");
    expect(launchFormKey(ev("Enter", { ctrlKey: true }), "BUTTON", true)).toBeNull();
    expect(launchFormKey(ev("Enter", { ctrlKey: true }), "BUTTON", false)).toBe("launch");
    expect(launchFormKey(ev("Enter", { metaKey: true }), "BUTTON", false)).toBeNull();
  });
  it("Enter on a button or a select, or mid-composition, keeps its own meaning", () => {
    expect(launchFormKey(ev("Enter"), "BUTTON")).toBeNull();
    expect(launchFormKey(ev("Enter"), "select")).toBeNull();
    expect(launchFormKey(ev("Enter", { isComposing: true }), "TEXTAREA")).toBeNull();
  });
});

describe("defaultModelLabel", () => {
  it("names the model and where it is set, else the generic label", () => {
    expect(defaultModelLabel({ model: "opus", source: "~/.claude/settings.json" })).toBe(
      "Default · opus (from ~/.claude/settings.json)",
    );
    expect(defaultModelLabel(null)).toBe("Default (the CLI's own setting)");
  });
});

describe("sessionNameDisplay", () => {
  const base = { session: null, localSessionId: null, cliNames: {}, localSessions: [] };
  const past = { agentId: "a1", alias: "jade" };
  it("a new session takes a name", () => {
    expect(sessionNameDisplay(base)).toEqual({ input: true });
  });
  it("a past session shows the CLI's name, else its codename", () => {
    expect(sessionNameDisplay({ ...base, session: past, cliNames: { a1: "exegoldev" } })).toEqual({
      input: false,
      name: "exegoldev",
    });
    expect(sessionNameDisplay({ ...base, session: past })).toEqual({ input: false, name: "jade" });
  });
  it("Continue last shows the newest session here when known; a Claude session by its name", () => {
    const localSessions = [
      { sessionId: "s1", name: "refactor", title: null },
      { sessionId: "s2", name: null, title: "fix the tests" },
    ];
    expect(sessionNameDisplay({ ...base, session: "last", localSessions })).toEqual({
      input: false,
      name: "refactor",
    });
    expect(sessionNameDisplay({ ...base, session: "last" })).toEqual({
      input: false,
      name: "the last session here",
    });
    expect(sessionNameDisplay({ ...base, localSessionId: "s2", localSessions })).toEqual({
      input: false,
      name: "fix the tests",
    });
  });
});

describe("sessionsInFolder", () => {
  const sessions = [
    { agentId: "1", cliType: "claude-code", folder: "/p/web" },
    { agentId: "2", cliType: "claude-code", folder: null },
    { agentId: "3", cliType: "codex", folder: "/p/web/" },
  ];
  it("keeps the agent's sessions in the folder; none recorded is the root", () => {
    const opts = { providerId: "claude-code", folder: "/p/web", projectPath: "/p" };
    expect(sessionsInFolder(sessions, opts)).toEqual({ sessions: [sessions[0]], scope: "folder" });
    const root = sessionsInFolder(sessions, { ...opts, folder: "/p" });
    expect(root.sessions.map((s) => s.agentId)).toEqual(["2"]);
  });
  it("any agent without a providerId; a trailing slash is the same folder", () => {
    const r = sessionsInFolder(sessions, { folder: "/p/web", projectPath: "/p" });
    expect(r.sessions.map((s) => s.agentId)).toEqual(["1", "3"]);
  });
  it("none in the folder: the agent's project-wide ones, said so", () => {
    const r = sessionsInFolder(sessions, {
      providerId: "claude-code",
      folder: "/p/api",
      projectPath: "/p",
    });
    expect(r.scope).toBe("project");
    expect(r.sessions).toHaveLength(2);
    const none = sessionsInFolder(sessions, {
      providerId: "goose",
      folder: "/p",
      projectPath: "/p",
    });
    expect(none).toEqual({ sessions: [], scope: "folder" });
  });
});

describe("quickRepoFolders", () => {
  const f = (rel: string, git = true) => ({ rel, git });
  it("is empty with fewer than two repos in subfolders", () => {
    expect(quickRepoFolders([f(""), f("app"), f("docs", false)], "").shown).toEqual([]);
  });

  it("lists the root then the repos, the rest counted", () => {
    const folders = [f(""), ...["a", "b", "c", "d", "e", "g", "h"].map((r) => f(r))];
    const q = quickRepoFolders(folders, "");
    expect(q.shown.map((x) => x.rel)).toEqual(["", "a", "b", "c", "d", "e"]);
    expect(q.more).toBe(2);
  });

  it("always shows the current repo", () => {
    const folders = [f(""), ...["a", "b", "c", "d", "e", "g", "h"].map((r) => f(r))];
    expect(quickRepoFolders(folders, "h").shown.map((x) => x.rel)).toEqual([
      "",
      "a",
      "b",
      "c",
      "d",
      "h",
    ]);
  });
});
