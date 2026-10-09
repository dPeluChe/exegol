import { describe, expect, it } from "vitest";
import { restartNeeded } from "./use-cli-updates";

const status = (installed: string | null, installedAt: number | null = null) => ({
  cliType: "claude-code",
  installed,
  installedAt,
  latest: null,
  updateAvailable: false,
  updateCommand: null,
  installMethod: null,
  updateNote: null,
});

describe("restartNeeded", () => {
  it("when the installed CLI is newer than the one the session started with", () => {
    expect(restartNeeded({ cliVersion: "2.1.286" }, status("2.1.290"))).toBe(true);
    expect(restartNeeded({ cliVersion: "2.1.290" }, status("2.1.290"))).toBe(false);
    expect(restartNeeded({ cliVersion: "2.1.286" }, undefined)).toBe(false);
  });

  it("a session without a recorded version: behind if the binary was written after it started", () => {
    const started = 1_790_000_000; // seconds, as agents store it
    expect(
      restartNeeded({ startedAt: started }, status("2.1.290", started * 1000 + 3_600_000)),
    ).toBe(true);
    expect(restartNeeded({ startedAt: started }, status("2.1.290", started * 1000 - 1000))).toBe(
      false,
    );
    // launched right after an install: not older
    expect(restartNeeded({ startedAt: started }, status("2.1.290", started * 1000 + 10_000))).toBe(
      false,
    );
    expect(restartNeeded({ startedAt: null }, status("2.1.290", 1))).toBe(false);
  });
});
