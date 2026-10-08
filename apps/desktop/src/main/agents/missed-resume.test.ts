import { describe, expect, it } from "vitest";
import {
  MISSED_RESUME_WINDOW_MS,
  noteAgentInput,
  noteBlindResume,
  takeMissedResume,
} from "./missed-resume";

describe("takeMissedResume", () => {
  const t0 = 1_000_000;

  it("flags a blind resume that exits with an error right away (devin -c, 2026-10-08)", () => {
    noteBlindResume("a1", t0);
    expect(takeMissedResume("a1", 1, false, t0 + 900)).toBe(true);
  });

  it("answers once per spawn, so a relaunch can never loop", () => {
    noteBlindResume("a2", t0);
    expect(takeMissedResume("a2", 1, false, t0 + 900)).toBe(true);
    expect(takeMissedResume("a2", 1, false, t0 + 950)).toBe(false);
  });

  it("ignores spawns that were not blind resumes", () => {
    expect(takeMissedResume("fresh", 1, false, t0)).toBe(false);
  });

  it("ignores a clean exit, a stop, and an exit after the startup window", () => {
    noteBlindResume("ok", t0);
    expect(takeMissedResume("ok", 0, false, t0 + 500)).toBe(false);
    noteBlindResume("stopped", t0);
    expect(takeMissedResume("stopped", 1, true, t0 + 500)).toBe(false);
    noteBlindResume("late", t0);
    expect(takeMissedResume("late", 1, false, t0 + MISSED_RESUME_WINDOW_MS + 1)).toBe(false);
  });

  it("stands down once the user typed, but not for the terminal's own replies", () => {
    noteBlindResume("typed", t0);
    noteAgentInput("typed", "\x1b[?1;2c");
    expect(takeMissedResume("typed", 1, false, t0 + 500)).toBe(true);
    noteBlindResume("typed2", t0);
    noteAgentInput("typed2", "hola\r");
    expect(takeMissedResume("typed2", 1, false, t0 + 500)).toBe(false);
  });
});
