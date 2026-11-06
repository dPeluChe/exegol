import type { ScreenDialog } from "@exegol/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { questionStep } from "./question-step";

const dialog = (fingerprint: string, picked = true): ScreenDialog => ({
  question: "Which one?",
  context: [],
  options: [],
  picked,
  fingerprint,
});

describe("questionStep", () => {
  it("alerts once a dialog holds still for two reads, and only once", () => {
    const state = {};
    expect(questionStep(state, dialog("a"))).toBe("none");
    expect(questionStep(state, dialog("a"))).toBe("alert");
    expect(questionStep(state, dialog("a"))).toBe("none");
  });

  it("does not count a screen that kept changing", () => {
    const state = {};
    expect(questionStep(state, dialog("a"))).toBe("none");
    expect(questionStep(state, dialog("b"))).toBe("none");
    expect(questionStep(state, null)).toBe("none");
  });

  it("never alerts on a numbered list with no selection on it", () => {
    const state = {};
    questionStep(state, dialog("a", false));
    expect(questionStep(state, dialog("a", false))).toBe("none");
  });

  it("releases when the dialog leaves, and a new question alerts again", () => {
    const state = {};
    questionStep(state, dialog("a"));
    questionStep(state, dialog("a"));
    expect(questionStep(state, null)).toBe("resolved");
    questionStep(state, dialog("b"));
    expect(questionStep(state, dialog("b"))).toBe("alert");
  });
});

const flags = vi.hoisted(() => ({
  awaiting: false,
  output: 0,
  dialog: null as ScreenDialog | null,
  status: "running",
}));
const bus = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("electron", () => ({}));
vi.mock("../notifications/bus", () => ({ getNotificationBus: () => bus }));
vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({ isAlive: () => true, screenDialog: () => flags.dialog }),
}));
vi.mock("./agent-message-queue", () => ({ isAgentAwaitingApproval: () => flags.awaiting }));
vi.mock("./agent-message-sweep", () => ({ lastAgentOutput: () => flags.output }));
vi.mock("./status-writes", () => ({
  writeAgentStatus: (_db: unknown, _id: string, status: string) => {
    flags.status = status;
  },
}));
vi.mock("./spawn-env", () => ({
  // As the real one: an attention push raises the approval flag, leaving waiting_input drops it
  broadcastAgentStatus: (event: { status: string; needsAttention?: boolean }) => {
    flags.awaiting = !!event.needsAttention || (flags.awaiting && event.status === "waiting_input");
  },
}));

const { checkQuestions } = await import("./question-watch");
const db = {
  prepare: () => ({
    all: () => [
      { id: "a1", project_id: "p", cli_type: "devin", status: flags.status, muted: null },
    ],
  }),
};
const check = () => {
  flags.output++;
  checkQuestions(db as never);
};

describe("checkQuestions", () => {
  beforeEach(() => {
    Object.assign(flags, { awaiting: false, dialog: null, status: "running" });
    bus.emit.mockClear();
  });

  it("moves the session to waiting, then back to running once the picker leaves", () => {
    flags.dialog = dialog("a");
    check();
    check();
    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(flags.status).toBe("waiting_input");
    flags.dialog = null;
    check();
    expect(flags.status).toBe("running");
    expect(flags.awaiting).toBe(false);
  });

  it("leaves a hook-reported approval to the hook", () => {
    flags.awaiting = true;
    flags.dialog = dialog("b");
    check();
    check();
    expect(bus.emit).not.toHaveBeenCalled();
  });
});
