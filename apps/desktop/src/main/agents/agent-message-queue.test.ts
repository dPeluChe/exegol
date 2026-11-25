import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../terminal/pty-host", () => ({ getPtyHost: () => ({ holdsEnter: () => false }) }));

import {
  forgetQueueState,
  isAgentAwaitingApproval,
  noteApprovalStatus,
} from "./agent-message-queue";

const ID = "a1";

describe("noteApprovalStatus", () => {
  afterEach(() => forgetQueueState(ID));

  it("keeps an approval through a waiting_input that reports no turn end", () => {
    noteApprovalStatus(ID, { status: "waiting_input", needsAttention: true });
    noteApprovalStatus(ID, { status: "waiting_input" });
    expect(isAgentAwaitingApproval(ID)).toBe(true);
  });

  it("drops it once the CLI reports the turn ended, or the session runs again", () => {
    noteApprovalStatus(ID, { status: "waiting_input", needsAttention: true });
    noteApprovalStatus(ID, { status: "waiting_input", turnEnded: 1 });
    expect(isAgentAwaitingApproval(ID)).toBe(false);

    noteApprovalStatus(ID, { status: "waiting_input", needsAttention: true, turnEnded: 2 });
    expect(isAgentAwaitingApproval(ID)).toBe(true);
    noteApprovalStatus(ID, { status: "running" });
    expect(isAgentAwaitingApproval(ID)).toBe(false);
  });
});
