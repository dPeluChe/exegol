import { describe, expect, it } from "vitest";
import {
  type LauncherAction,
  launcherActions,
  launcherFocusAllowed,
  launcherFolder,
  launcherKeyAction,
  launchFormKey,
  matchFolders,
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
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...mods,
  }) as KeyboardEvent;

describe("launcherKeyAction", () => {
  const all: LauncherAction[] = ["terminal", "files", "git", "browser", "finder", "editor"];
  it("1-9 pick agents in grid order, within the grid", () => {
    expect(launcherKeyAction(key("1"), false, all, 3)).toEqual({ agentIndex: 0 });
    expect(launcherKeyAction(key("3"), false, all, 3)).toEqual({ agentIndex: 2 });
    expect(launcherKeyAction(key("4"), false, all, 3)).toBeNull();
    expect(launcherKeyAction(key("0"), false, all, 3)).toBeNull();
  });
  it("letters open the pane's views, only those offered", () => {
    expect(launcherKeyAction(key("T"), false, all, 0)).toEqual({ action: "terminal" });
    expect(launcherKeyAction(key("o"), false, all, 0)).toEqual({ action: "finder" });
    expect(launcherKeyAction(key("e"), false, ["terminal"], 0)).toBeNull();
    expect(launcherKeyAction(key("s"), false, all, 0)).toBeNull();
  });
  it("/ and Cmd+F (Ctrl+F) open the folder filter", () => {
    expect(launcherKeyAction(key("/"), false, all, 0)).toEqual({ folder: true });
    expect(launcherKeyAction(key("f", { metaKey: true }), false, all, 0)).toEqual({
      folder: true,
    });
    expect(launcherKeyAction(key("f", { ctrlKey: true }), false, all, 0)).toEqual({
      folder: true,
    });
  });
  it("never while typing, on a repeat, with Alt or another app chord", () => {
    expect(launcherKeyAction(key("t"), true, all, 0)).toBeNull();
    expect(launcherKeyAction(key("1", { repeat: true }), false, all, 3)).toBeNull();
    expect(launcherKeyAction(key("t", { altKey: true }), false, all, 0)).toBeNull();
    expect(launcherKeyAction(key("t", { metaKey: true }), false, all, 0)).toBeNull();
    expect(
      launcherKeyAction(key("f", { metaKey: true, shiftKey: true }), false, all, 0),
    ).toBeNull();
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
    expect(launchFormKey(ev("Enter", { metaKey: true }), "BUTTON")).toBe("launch");
    expect(launchFormKey(ev("Enter", { shiftKey: true }), "TEXTAREA")).toBeNull();
  });
  it("Enter on a button or a select, or mid-composition, keeps its own meaning", () => {
    expect(launchFormKey(ev("Enter"), "BUTTON")).toBeNull();
    expect(launchFormKey(ev("Enter"), "select")).toBeNull();
    expect(launchFormKey(ev("Enter", { isComposing: true }), "TEXTAREA")).toBeNull();
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
