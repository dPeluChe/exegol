import { describe, expect, it } from "vitest";
import { FEED_MAX_LINES, feedEvents, feedMessage, feedSnapshot } from "./feed";
import type { FleetProject, SessionState } from "./fleet";

const fleet = (states: Record<string, SessionState>, inbox = 0): FleetProject[] => [
  {
    project: "Landing",
    inbox_waiting: inbox,
    sessions: Object.entries(states).map(([id, state]) => ({
      id,
      name: id,
      cli: "claude-code",
      state,
      minutes_in_state: 0,
      quiet_minutes: 0,
      task: "",
    })),
  },
];

describe("the Commander's feed", () => {
  it("reports turn ends, waits, closes and new threads, and nothing else", () => {
    const before = feedSnapshot(
      fleet({ a: "working", b: "working", c: "waits_on_person", d: "at_prompt", e: "at_prompt" }),
      0,
    );
    const after = feedSnapshot(
      fleet(
        { a: "at_prompt", b: "waits_on_person", c: "at_prompt", e: "working", f: "working" },
        1,
      ),
      1,
    );
    expect(feedEvents(before, after).map((e) => e.line)).toEqual([
      "a (Landing) ended its turn",
      "b (Landing) waits on the person: a permission or dialog on its screen",
      "d (Landing) closed",
      "New thread in the personal inbox",
      "New inbox thread in Landing",
    ]);
    expect(feedEvents(after, after)).toEqual([]);
  });

  it("drops what no longer holds when it is sent, and caps the lines", () => {
    const before = feedSnapshot(fleet({ a: "working", b: "working" }), 0);
    const ended = feedSnapshot(fleet({ a: "at_prompt", b: "at_prompt" }), 0);
    const now = feedSnapshot(fleet({ a: "working", b: "at_prompt" }), 0);
    const events = feedEvents(before, ended);
    const text = feedMessage(events, now, ["c: running 40m"]) ?? "";
    expect(text).toContain("b (Landing) ended its turn");
    expect(text).toContain("c: running 40m");
    expect(text).not.toContain("a (Landing)");
    expect(feedMessage(events, feedSnapshot(fleet({}), 0), [])).toBeNull();
    const many = Array.from({ length: FEED_MAX_LINES + 3 }, (_, i) => `n${i}`);
    expect(feedMessage([], now, many)).toContain("and 3 more");
  });
});
