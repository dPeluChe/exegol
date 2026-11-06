import type { ScreenDialog } from "@exegol/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
vi.mock("../db/queries", () => ({ isAgentQuiet: () => false }));
vi.mock("./agent-message-queue", () => ({ isAgentAwaitingApproval: () => false }));
vi.mock("./agent-message-sweep", () => ({ lastAgentOutput: () => 1 }));
vi.mock("./spawn-env", () => ({ broadcastAgentStatus: vi.fn() }));
vi.mock("./status-writes", () => ({ writeAgentStatus: vi.fn() }));
vi.mock("../terminal/pty-host", () => ({ getPtyHost: vi.fn() }));
vi.mock("../notifications/bus", () => ({ getNotificationBus: vi.fn() }));

const { questionStep } = await import("./question-watch");

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
