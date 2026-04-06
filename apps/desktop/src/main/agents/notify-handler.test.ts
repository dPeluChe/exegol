import { describe, expect, it, vi } from "vitest";
import {
  type AgentEvent,
  emitAgentEvent,
  startNotifyHandler,
  stopNotifyHandler,
} from "./notify-handler";

describe("emitAgentEvent", () => {
  it("calls registered callback", () => {
    const callback = vi.fn();
    startNotifyHandler(callback);

    const event: AgentEvent = {
      type: "task_complete",
      agentId: "test-123",
      ts: Date.now(),
    };
    emitAgentEvent(event);

    expect(callback).toHaveBeenCalledWith(event);
    stopNotifyHandler();
  });

  it("does nothing when no handler registered", () => {
    stopNotifyHandler();
    // Should not throw
    emitAgentEvent({
      type: "stop",
      agentId: "test-456",
      ts: Date.now(),
    });
  });

  it("passes payload through", () => {
    const callback = vi.fn();
    startNotifyHandler(callback);

    const event: AgentEvent = {
      type: "tool_use",
      agentId: "test-789",
      ts: Date.now(),
      payload: { tool: "Edit", file: "src/main.ts" },
    };
    emitAgentEvent(event);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_use",
        payload: { tool: "Edit", file: "src/main.ts" },
      }),
    );
    stopNotifyHandler();
  });

  it("stops receiving events after stopNotifyHandler", () => {
    const callback = vi.fn();
    startNotifyHandler(callback);
    stopNotifyHandler();

    emitAgentEvent({ type: "stop", agentId: "test", ts: Date.now() });
    expect(callback).not.toHaveBeenCalled();
  });
});
