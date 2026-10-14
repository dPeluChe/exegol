import type { AgentStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  buildSendSections,
  hasSendTargets,
  sendAction,
  sendHint,
  sendLabel,
  sendToActive,
} from "./send-targets";

const session = (
  id: string,
  projectId: string,
  extra: {
    cliType?: string;
    status?: AgentStatus;
    alias?: string | null;
    launchedInShell?: boolean;
    archived?: boolean;
    suspended?: boolean;
  } = {},
) => ({
  id,
  projectId,
  cliType: "claude-code",
  status: "running" as AgentStatus,
  alias: null,
  ...extra,
});

const names = new Map([
  ["pa", "Alpha"],
  ["pb", "Beta"],
  ["pc", "Current"],
  ["pz", "Zeta"],
]);

describe("buildSendSections", () => {
  it("lists this project's live agents first, never the source nor ended ones", () => {
    const { own, others } = buildSendSections(
      [
        session("self", "pc"),
        session("a", "pc", { alias: "lupus" }),
        session("done", "pc", { status: "completed" }),
        session("w", "pc", { cliType: "opencode", status: "waiting_input" }),
      ],
      "self",
      names,
      "pc",
    );
    expect(own).toEqual({
      projectId: "pc",
      projectName: "Current",
      targets: [
        { id: "a", name: "lupus", cliType: "claude-code", projectId: "pc" },
        { id: "w", name: "opencode", cliType: "opencode", projectId: "pc" },
      ],
    });
    expect(others).toEqual([]);
  });

  it("hides this project when it has no other session, keeping the others", () => {
    const sections = buildSendSections(
      [session("self", "pc"), session("z", "pz")],
      "self",
      names,
      "pc",
    );
    expect(sections.own).toBeNull();
    expect(sections.others.map((g) => g.projectName)).toEqual(["Zeta"]);
    expect(hasSendTargets(sections)).toBe(true);
  });

  it("is empty with nothing to send to", () => {
    const sections = buildSendSections([session("self", "pc")], "self", names, "pc");
    expect(sections).toEqual({ own: null, others: [] });
    expect(hasSendTargets(sections)).toBe(false);
  });

  it("orders other projects by the sidebar order, then by name", () => {
    const { others } = buildSendSections(
      [session("z", "pz"), session("a", "pa"), session("b", "pb"), session("c", "pc")],
      "self",
      names,
      "pc",
      ["pz", "pb"],
    );
    expect(others.map((g) => g.projectName)).toEqual(["Zeta", "Beta", "Alpha"]);
  });

  it("an agent can send to a plain terminal, shown with its folder", () => {
    const { own } = buildSendSections(
      [
        session("self", "pc"),
        session("sh", "pc", { cliType: "shell" }),
        session("gone", "pc", { cliType: "shell", status: "stopped" }),
        session("zz", "pc", { cliType: "shell", suspended: true }),
      ],
      "self",
      names,
      "pc",
      [],
      new Map([["sh", "/Users/me/code/web/"]]),
    );
    expect(own?.targets).toEqual([
      { id: "sh", name: "Terminal", cliType: "shell", projectId: "pc", folder: "web" },
    ]);
  });

  it("a terminal can send to an agent, and a typed CLI back at its prompt is a terminal", () => {
    const { own } = buildSendSections(
      [
        session("shell-self", "pc", { cliType: "shell" }),
        session("a", "pc"),
        session("typed", "pc", { cliType: "codex", launchedInShell: true }),
        session("exited", "pc", { cliType: "codex", launchedInShell: true, status: "idle" }),
      ],
      "shell-self",
      names,
      "pc",
    );
    expect(own?.targets.map((t) => [t.id, t.cliType])).toEqual([
      ["a", "claude-code"],
      ["typed", "codex"],
      ["exited", "shell"],
    ]);
  });
});

describe("sendAction", () => {
  const shell = { cliType: "shell" };
  const agent = { cliType: "claude-code" };
  const prefs = (run: boolean, submit: boolean) => ({
    sendToRunTerminal: run,
    sendToSubmitAgent: submit,
  });

  it("pastes only by default, asking or not", () => {
    for (const asks of [false, true]) {
      expect(sendAction(shell, prefs(false, false), asks)).toBe("paste");
      expect(sendAction(agent, prefs(false, false), asks)).toBe("paste");
    }
  });

  it("each setting presses Enter for its own kind of target only", () => {
    expect(sendAction(shell, prefs(true, false), false)).toBe("enter");
    expect(sendAction(agent, prefs(true, false), false)).toBe("paste");
    expect(sendAction(agent, prefs(false, true), false)).toBe("enter");
    expect(sendAction(shell, prefs(false, true), false)).toBe("paste");
  });

  it("never submits into an agent asking a question", () => {
    expect(sendAction(agent, prefs(true, true), true)).toBe("held");
    expect(sendAction(agent, prefs(false, true), true)).toBe("held");
  });
});

describe("sendLabel", () => {
  const target = (extra: { name: string; cliType?: string; folder?: string }) => ({
    id: "x",
    projectId: "p",
    cliType: "claude-code",
    ...extra,
  });

  it("an agent: its alias and the CLI's session name, never the CLI id (the icon says it)", () => {
    expect(sendLabel(target({ name: "argo" }), "exegoldev")).toBe("argo · exegoldev");
    expect(sendLabel(target({ name: "argo" }))).toBe("argo");
    expect(sendLabel(target({ name: "argo" }), "argo")).toBe("argo");
    expect(sendLabel(target({ name: "claude-code" }), "exegoldev")).toBe("exegoldev");
    expect(sendLabel(target({ name: "claude-code" }))).toBe("claude-code");
  });

  it("a terminal: Terminal and its folder", () => {
    expect(sendLabel(target({ name: "Terminal", cliType: "shell", folder: "web" }))).toBe(
      "Terminal · web",
    );
    expect(sendLabel(target({ name: "Terminal", cliType: "shell" }), "ignored")).toBe("Terminal");
  });
});

describe("sendToActive", () => {
  it("shows with a selection and stays while the list is open, even if the TUI cleared it", () => {
    expect(sendToActive(true, false)).toBe(true);
    expect(sendToActive(false, true)).toBe(true);
    expect(sendToActive(false, false)).toBe(false);
  });
});

describe("sendHint", () => {
  it("says what a pick does", () => {
    const hint = (run: boolean, submit: boolean) =>
      sendHint({ sendToRunTerminal: run, sendToSubmitAgent: submit });
    expect(hint(false, false)).toBe("Pastes only");
    expect(hint(true, false)).toBe("Pastes; runs it in terminals");
    expect(hint(false, true)).toBe("Pastes; submits it to agents");
    expect(hint(true, true)).toBe("Pastes and presses Enter");
  });
});
