import { describe, expect, it } from "vitest";
import {
  endedActions,
  endedFocusAllowed,
  endedHeader,
  endedKeyAction,
  endedKeysLive,
  folderLabel,
  statusChipText,
} from "./ended-session";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  ...mods,
});

describe("endedActions", () => {
  it("resumable agent: Resume first, then the launcher", () => {
    expect(endedActions({ isShell: false, canResume: true, hasPane: true })).toEqual([
      "resume",
      "new",
      "terminal",
      "files",
      "browser",
    ]);
  });
  it("not resumable: Restart instead", () => {
    expect(endedActions({ isShell: false, canResume: false, hasPane: true })[0]).toBe("restart");
  });
  it("shell: reopen, no new session or terminal entry", () => {
    expect(endedActions({ isShell: true, canResume: false, hasPane: true })).toEqual([
      "reopen",
      "files",
      "browser",
    ]);
  });
  it("no pane: only the primary action", () => {
    expect(endedActions({ isShell: false, canResume: true, hasPane: false })).toEqual(["resume"]);
  });
});

describe("endedKeyAction", () => {
  const agent = endedActions({ isShell: false, canResume: true, hasPane: true });
  const shell = endedActions({ isShell: true, canResume: false, hasPane: true });
  it("maps the launcher letters", () => {
    expect(endedKeyAction(key("r"), false, agent, 0)).toEqual({ action: "resume" });
    expect(endedKeyAction(key("N"), false, agent, 0)).toEqual({ action: "new" });
    expect(endedKeyAction(key("t"), false, agent, 0)).toEqual({ action: "terminal" });
    expect(endedKeyAction(key("f"), false, agent, 0)).toEqual({ action: "files" });
    expect(endedKeyAction(key("b"), false, agent, 0)).toEqual({ action: "browser" });
  });
  it("R and T both reopen a shell; N does nothing there", () => {
    expect(endedKeyAction(key("r"), false, shell, 0)).toEqual({ action: "reopen" });
    expect(endedKeyAction(key("t"), false, shell, 0)).toEqual({ action: "reopen" });
    expect(endedKeyAction(key("n"), false, shell, 0)).toBeNull();
  });
  it("numbers pick an agent in range", () => {
    expect(endedKeyAction(key("1"), false, agent, 3)).toEqual({ agentIndex: 0 });
    expect(endedKeyAction(key("4"), false, agent, 3)).toBeNull();
    expect(endedKeyAction(key("0"), false, agent, 3)).toBeNull();
  });
  it("ignores typing, chords and repeats", () => {
    expect(endedKeyAction(key("r"), true, agent, 0)).toBeNull();
    expect(endedKeyAction(key("r", { metaKey: true }), false, agent, 0)).toBeNull();
    expect(endedKeyAction(key("r", { ctrlKey: true }), false, agent, 0)).toBeNull();
    expect(endedKeyAction(key("r", { altKey: true }), false, agent, 0)).toBeNull();
    expect(endedKeyAction(key("r", { repeat: true }), false, agent, 0)).toBeNull();
  });
});

describe("folderLabel", () => {
  it("is null at the project root", () => {
    expect(folderLabel("/p/app", "/p/app")).toBeNull();
    expect(folderLabel("/p/app/", "/p/app")).toBeNull();
    expect(folderLabel(null, "/p/app")).toBeNull();
  });
  it("is the basename elsewhere", () => {
    expect(folderLabel("/home/.exegol/worktrees/app/feat-x", "/p/app")).toBe("feat-x");
    expect(folderLabel("/p/app/web/", "/p/app")).toBe("web");
  });
});

describe("endedHeader", () => {
  it("names the CLI, the session and where it ran", () => {
    expect(
      endedHeader({
        cliName: "Claude Code",
        name: "brave-otter",
        projectName: "exegol",
        folder: "feat-x",
      }),
    ).toEqual(["Claude Code ended", "brave-otter", "exegol / feat-x"]);
  });
  it("drops what is unknown and says suspended", () => {
    expect(endedHeader({ cliName: "Codex", projectName: "exegol", suspended: true })).toEqual([
      "Codex suspended",
      "exegol",
    ]);
  });
});

describe("statusChipText", () => {
  it("adds the exit code when known", () => {
    expect(statusChipText("completed", 0)).toBe("completed · exit 0");
    expect(statusChipText("crashed")).toBe("crashed");
    expect(statusChipText("stopped", 130, true)).toBe("suspended · exit 130");
  });
});

describe("endedKeysLive", () => {
  const base = { mountedAt: 1000, now: 1600, focusInside: true, held: false };
  it("live with the focus inside, after the settle time", () => {
    expect(endedKeysLive(base)).toBe(true);
  });
  it("stray typing right after the exit is ignored", () => {
    expect(endedKeysLive({ ...base, now: 1200 })).toBe(false);
  });
  it("needs the focus inside the launcher", () => {
    expect(endedKeysLive({ ...base, focusInside: false })).toBe(false);
  });
  it("never while a respawn is on its way", () => {
    expect(endedKeysLive({ ...base, held: true })).toBe(false);
  });
});

describe("endedFocusAllowed", () => {
  const el = (tagName: string, opts: { xterm?: boolean; type?: string } = {}) => ({
    tagName,
    type: opts.type,
    closest: (sel: string) => (sel === ".xterm" && opts.xterm ? {} : null),
  });
  const body = el("BODY");
  const launcherBtn = el("BUTTON");
  const scrollbackTextarea = el("TEXTAREA", { xterm: true });
  const paneInput = el("INPUT", { type: "text" });
  const paneDiv = el("DIV");
  const elsewhere = el("TEXTAREA");
  const inPane = new Set<unknown>([launcherBtn, scrollbackTextarea, paneInput, paneDiv]);
  const ctx = {
    body,
    launcher: { contains: (n: never) => n === launcherBtn },
    pane: { contains: (n: never) => inPane.has(n) },
  };
  it("accepts body (the CLI's xterm just went away) and nothing focused", () => {
    expect(endedFocusAllowed(body, ctx)).toBe(true);
    expect(endedFocusAllowed(null, ctx)).toBe(true);
  });
  it("accepts the launcher and the scrollback xterm's helper textarea", () => {
    expect(endedFocusAllowed(launcherBtn, ctx)).toBe(true);
    expect(endedFocusAllowed(scrollbackTextarea, ctx)).toBe(true);
    expect(endedFocusAllowed(paneDiv, ctx)).toBe(true);
  });
  it("refuses a real text field in the pane and anything outside it", () => {
    expect(endedFocusAllowed(paneInput, ctx)).toBe(false);
    expect(endedFocusAllowed(elsewhere, ctx)).toBe(false);
  });
});
