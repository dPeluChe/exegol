import { describe, expect, it } from "vitest";
import { settleAllReattach } from "../terminal/reattach-gate";
import { AUTO_RESUME_MAX_IDLE_MS, lastActiveOf, shellResumeFolder, splitLost } from "./auto-resume";
import { setLostOnRestart, settleLost, takeLostOnRestart } from "./lost-sessions";

describe("lost sessions after a restart", () => {
  it("waits for recovery, then hands them out until they are settled", async () => {
    const lost = [
      { id: "a", lastActiveAt: 1 },
      { id: "b", lastActiveAt: 2 },
    ];
    const pending = takeLostOnRestart();
    setLostOnRestart(lost);
    settleAllReattach();
    expect(await pending).toEqual(lost);
    expect(await takeLostOnRestart()).toEqual(lost);
    settleLost(["a", "b"]);
    expect(await takeLostOnRestart()).toEqual([]);
  });
});

describe("auto-resume plan", () => {
  const DAY = 86_400_000;
  const now = 100 * DAY;

  it("resumes sessions active in the last 3 days, most recent first; keeps the rest", () => {
    const { resume, keep } = splitLost(
      [
        { id: "old", lastActiveAt: now - 4 * DAY },
        { id: "yesterday", lastActiveAt: now - DAY },
        { id: "edge", lastActiveAt: now - AUTO_RESUME_MAX_IDLE_MS },
        { id: "hour", lastActiveAt: now - 3_600_000 },
        { id: "never", lastActiveAt: 0 },
      ],
      now,
    );
    expect(resume.map((s) => s.id)).toEqual(["hour", "yesterday", "edge"]);
    expect(keep.map((s) => s.id)).toEqual(["old", "never"]);
  });

  it("last activity is the newest of activity, status change and start", () => {
    expect(lastActiveOf({ last_activity_at: 5000, status_changed_at: 7000, started_at: 3 })).toBe(
      7000,
    );
    expect(lastActiveOf({ last_activity_at: null, status_changed_at: null, started_at: 9 })).toBe(
      9000,
    );
    expect(lastActiveOf({})).toBe(0);
  });
});

describe("resumed shell folder", () => {
  it("keeps a folder that exists inside the project, else the project root", () => {
    expect(shellResumeFolder("/p/app", true, true)).toEqual({ cwd: "/p/app", decision: "kept" });
    expect(shellResumeFolder("/p/gone", false, false)).toEqual({
      cwd: undefined,
      decision: "gone",
    });
    expect(shellResumeFolder("/etc", true, false)).toEqual({
      cwd: undefined,
      decision: "outside the project",
    });
    expect(shellResumeFolder(null, false, false)).toEqual({ cwd: undefined, decision: "none" });
  });
});
