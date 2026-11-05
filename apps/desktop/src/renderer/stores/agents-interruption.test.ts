import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStore } from "./agents";
import { useNotificationPrefsStore } from "./notification-prefs";

vi.mock("../lib/trpc-client", () => ({ trpcInvoke: () => Promise.resolve() }));

describe("attention items under an interruption level", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: {
        a1: { id: "a1", projectId: "p1", cliType: "claude-code", status: "waiting_input" },
      } as never,
      attentionItems: {},
      unreadAttentionCount: 0,
    });
  });

  it("records a question on a quiet project without an unread badge", () => {
    useNotificationPrefsStore.getState().setLevel("p1", "none");
    useAgentStore.getState().addAttentionItem("a1", { level: "action_needed", reason: "Asks" });

    const { attentionItems, unreadAttentionCount } = useAgentStore.getState();
    expect(attentionItems.a1).toMatchObject({ level: "action_needed", read: true });
    expect(unreadAttentionCount).toBe(0);
  });
});
