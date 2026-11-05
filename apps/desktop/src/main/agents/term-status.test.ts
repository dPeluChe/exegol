import { describe, expect, it, vi } from "vitest";
import type { TermReport } from "./osc-status-scanner";
import {
  forgetTermStatus,
  INITIAL_TERM_STATUS,
  noteHookSignal,
  takeTermStatus,
  termStatusSignals,
} from "./term-status";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const progress = (state: string): TermReport => ({ kind: "progress", state, detail: null });
const status = (state: string, detail: string | null = null): TermReport => ({
  kind: "status",
  state,
  detail,
});

function run(...batches: TermReport[][]) {
  let state = INITIAL_TERM_STATUS;
  return batches.map((reports) => {
    const out = termStatusSignals(state, reports);
    state = out.state;
    return out.signals;
  });
}

describe("termStatusSignals", () => {
  it("reads a progress turn: start, repeats, clear", () => {
    expect(
      run([progress("0")], [progress("3")], [progress("1"), progress("1")], [progress("0")]),
    ).toEqual([[], ["turn_started"], [], ["finished"]]);
  });

  it("an error report keeps the turn going and still ends as finished", () => {
    expect(run([progress("3")], [progress("2")], [progress("0")])).toEqual([
      ["turn_started"],
      [],
      ["finished"],
    ]);
  });

  it("maps program status: blocked asks, working after blocked is no new turn", () => {
    expect(
      run(
        [status("idle")],
        [status("working")],
        [status("blocked", "permission")],
        [status("working")],
        [status("done")],
        [status("idle")],
      ),
    ).toEqual([[], ["turn_started"], ["attention"], ["working"], ["finished"], []]);
  });

  it("error and a cancelled run (idle) end the turn", () => {
    expect(run([status("working")], [status("error")])).toEqual([["turn_started"], ["finished"]]);
    expect(run([status("working")], [status("idle")])).toEqual([["turn_started"], ["finished"]]);
  });

  it("once a program speaks 7501, its progress reports are ignored", () => {
    expect(
      run([progress("3"), status("blocked"), progress("3")], [status("done"), progress("0")]),
    ).toEqual([["turn_started", "attention"], ["finished"]]);
  });

  it("queries change nothing", () => {
    const out = termStatusSignals(INITIAL_TERM_STATUS, [
      { kind: "query", state: "", detail: null },
    ]);
    expect(out).toEqual({ state: INITIAL_TERM_STATUS, signals: [] });
  });
});

describe("takeTermStatus", () => {
  const query: TermReport = { kind: "query", state: "", detail: null };

  it("asks for the 7501 reply on every query, hooks or not", () => {
    expect(takeTermStatus("a1", "pi", [query])).toEqual({ signals: [], reply: true });
    noteHookSignal("a1");
    expect(takeTermStatus("a1", "pi", [query]).reply).toBe(true);
    forgetTermStatus("a1");
  });

  it("hooks win: once one spoke, the reports keep their state but send no signal", () => {
    expect(takeTermStatus("a2", "claude-code", [status("working")]).signals).toEqual([
      "turn_started",
    ]);
    noteHookSignal("a2");
    expect(takeTermStatus("a2", "claude-code", [status("done")]).signals).toEqual([]);
    forgetTermStatus("a2");
    expect(takeTermStatus("a2", "claude-code", [status("working")]).signals).toEqual([
      "turn_started",
    ]);
    forgetTermStatus("a2");
  });
});
