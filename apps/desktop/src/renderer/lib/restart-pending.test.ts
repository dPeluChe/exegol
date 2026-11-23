import { describe, expect, it } from "vitest";
import { pendingRestartText } from "./restart-pending";

const NOW = 10_000_000;
const session = (activityLevel: "busy" | "idle", minutes: number) => ({
  status: activityLevel === "busy" ? ("running" as const) : ("waiting_input" as const),
  activityLevel,
  activitySince: NOW - minutes * 60_000,
});

describe("pendingRestartText", () => {
  it("says how long the turn has run only while the session shows as working", () => {
    expect(pendingRestartText(session("busy", 125), false, NOW).working).toBe(
      "It has shown as working for 2h 5m.",
    );
    expect(pendingRestartText(session("idle", 125), false, NOW).working).toBeNull();
  });

  it("names the cost of restarting now while an update is on its way", () => {
    expect(pendingRestartText(session("busy", 1), false, NOW).nowLabel).toBe("Restart now");
    const update = pendingRestartText(session("busy", 1), true, NOW);
    expect(update.nowLabel).toBe("Restart now, without the update");
    expect(update.nowNote).toContain("restart again");
  });
});
