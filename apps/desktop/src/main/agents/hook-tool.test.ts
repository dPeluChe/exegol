import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHookTool, noteHookTool } from "./hook-tool";

const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("../lib/event-bus", () => ({ broadcast }));

describe("noteHookTool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    broadcast.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("pushes only the last tool of a burst", () => {
    noteHookTool("burst", "Read");
    noteHookTool("burst", "Edit");
    vi.advanceTimersByTime(1000);
    expect(broadcast.mock.calls).toEqual([
      ["agent:activity", { agentId: "burst", activity: "edits" }],
    ]);
  });

  it("stays quiet while the activity is the same, and after a new turn pushes again", () => {
    noteHookTool("steady", "Edit");
    vi.advanceTimersByTime(1000);
    noteHookTool("steady", "Write");
    vi.advanceTimersByTime(1000);
    expect(broadcast).toHaveBeenCalledTimes(1);

    clearHookTool("steady");
    noteHookTool("steady", "Write");
    vi.advanceTimersByTime(1000);
    expect(broadcast.mock.calls.at(-1)).toEqual([
      "agent:activity",
      { agentId: "steady", activity: "edits" },
    ]);
  });

  it("drops a name that is not a plain identifier", () => {
    noteHookTool("odd", "rm -rf");
    vi.advanceTimersByTime(1000);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
