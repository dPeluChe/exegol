import { describe, expect, it } from "vitest";
import {
  MISSED_RESUME_WINDOW_MS,
  noteAgentInput,
  noteBlindResume,
  saidNoSession,
  takeMissedResume,
} from "./missed-resume";

const t0 = 1_000_000;
const NO_SESSION = "Error: No sessions to continue in this directory.\r\n";
const exit = (over: Partial<Parameters<typeof takeMissedResume>[1]> = {}) => ({
  exitCode: 1,
  stopRequested: false,
  cliType: "devin",
  tail: NO_SESSION,
  ...over,
});

describe("takeMissedResume", () => {
  it("flags a blind resume that says it had no session and exits (devin -c, 2026-10-08)", () => {
    noteBlindResume("a1", t0);
    expect(takeMissedResume("a1", exit(), t0 + 900)).toBe(true);
  });

  it("answers once per spawn, so a relaunch can never loop", () => {
    noteBlindResume("a2", t0);
    expect(takeMissedResume("a2", exit(), t0 + 900)).toBe(true);
    expect(takeMissedResume("a2", exit(), t0 + 950)).toBe(false);
  });

  it("ignores spawns that were not blind resumes", () => {
    expect(takeMissedResume("fresh", exit(), t0)).toBe(false);
  });

  // Auth, API key, a bad flag, the network: the error stays visible
  it("leaves any other fast failure alone", () => {
    noteBlindResume("auth", t0);
    expect(takeMissedResume("auth", exit({ tail: "Error: not logged in" }), t0 + 500)).toBe(false);
  });

  it("ignores a clean exit, a stop, and an exit after the startup window", () => {
    noteBlindResume("ok", t0);
    expect(takeMissedResume("ok", exit({ exitCode: 0 }), t0 + 500)).toBe(false);
    noteBlindResume("stopped", t0);
    expect(takeMissedResume("stopped", exit({ stopRequested: true }), t0 + 500)).toBe(false);
    noteBlindResume("late", t0);
    expect(takeMissedResume("late", exit(), t0 + MISSED_RESUME_WINDOW_MS + 1)).toBe(false);
  });

  it("stands down on any input but the terminal's own replies", () => {
    noteBlindResume("replies", t0);
    noteAgentInput("replies", "\x1b[?1;2c\x1b[12;40R\x1b[I");
    expect(takeMissedResume("replies", exit(), t0 + 500)).toBe(true);
    noteBlindResume("arrow", t0);
    noteAgentInput("arrow", "\x1b[A");
    expect(takeMissedResume("arrow", exit(), t0 + 500)).toBe(false);
    noteBlindResume("typed", t0);
    noteAgentInput("typed", "hola\r");
    expect(takeMissedResume("typed", exit(), t0 + 500)).toBe(false);
  });
});

describe("saidNoSession", () => {
  it("knows each CLI's own message and the common wording", () => {
    expect(saidNoSession("claude-code", "No conversation found to continue")).toBe(true);
    expect(saidNoSession("factory-droid", "Error: No sessions found in current directory.")).toBe(
      true,
    );
    expect(saidNoSession("aider", "No previous session to resume")).toBe(true);
    expect(saidNoSession("aider", "Invalid API key")).toBe(false);
  });
});
