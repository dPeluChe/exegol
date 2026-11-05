import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteHookTool } from "./hook-tool";

const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("../lib/event-bus", () => ({ broadcast }));

describe("noteHookTool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    broadcast.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("pushes only the last tool of a burst, and nothing while it stays the same", () => {
    noteHookTool("burst", "Read");
    noteHookTool("burst", "Edit");
    vi.advanceTimersByTime(1000);
    expect(broadcast.mock.calls).toEqual([["agent:activity", { agentId: "burst", tool: "Edit" }]]);

    noteHookTool("burst", "Edit");
    vi.advanceTimersByTime(1000);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("drops a name that is not a plain identifier", () => {
    noteHookTool("odd", "rm -rf");
    vi.advanceTimersByTime(1000);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
