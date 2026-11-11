import { describe, expect, it } from "vitest";
import { FEED_MAX_LINES, feedEvents, feedMessage, feedSnapshot } from "./feed";
import type { FleetProject, SessionState } from "./fleet";

const fleet = (
  states: Record<string, SessionState>,
  inbox = 0,
  attended: string[] = [],
  idle = 0,
): FleetProject[] => [
  {
    project: "Landing",
    inbox_waiting: inbox,
    sessions: Object.entries(states).map(([id, state]) => ({
      id,
      name: id,
      cli: "claude-code",
      state,
      minutes_in_state: idle,
      quiet_minutes: 0,
      person_minutes_ago: attended.includes(id) ? 1 : null,
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

  it("tells a suspended or restarted session from a closed one", () => {
    const before = feedSnapshot(fleet({ a: "working", b: "working", c: "working" }), 0);
    const after = feedSnapshot(fleet({ a2: "working", z: "working", y: "working" }), 0);
    const moves = new Map([
      ["a2", { resumedFrom: "a", suspended: false }],
      ["b", { resumedFrom: null, suspended: true }],
      ["y", { resumedFrom: "gone", suspended: false }],
    ]);
    expect(feedEvents(before, after, moves).map((e) => [e.key, e.line])).toEqual([
      ["a", "a2 (Landing) restarted: the same session, still open"],
      ["gone", "y (Landing) resumed: the same session, still open"],
      ["b", "b (Landing) suspended: its work is kept, it can be resumed"],
      ["c", "c (Landing) closed"],
    ]);
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

  it("leaves the turn ends of a session the person is writing to", () => {
    const before = feedSnapshot(fleet({ a: "working", b: "working" }), 0);
    const after = feedSnapshot(fleet({ a: "at_prompt", b: "at_prompt" }, 0, ["a"]), 0);
    expect(feedEvents(before, after).map((e) => e.key)).toEqual(["b"]);
  });

  it("says once when a session has waited at its prompt with no word from the person", () => {
    const at = (idle: number, attended: string[] = []) =>
      feedSnapshot(fleet({ a: "at_prompt" }, 0, attended, idle), 0);
    expect(feedEvents(at(14), at(15)).map((e) => e.line)).toEqual([
      "a (Landing) has been at its prompt 15 min with no reply from the person: read it and ask them how to go on",
    ]);
    expect(feedEvents(at(15), at(16))).toEqual([]);
    expect(feedEvents(at(14), at(15, ["a"]))).toEqual([]);
  });
});
