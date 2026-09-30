import { describe, expect, it } from "vitest";
import { restartNeeded } from "./use-cli-updates";

const status = (installed: string | null) => ({
  cliType: "claude-code",
  installed,
  latest: null,
  updateAvailable: false,
  updateCommand: null,
});

describe("restartNeeded", () => {
  it("only when the installed CLI is newer than the one the session started with", () => {
    expect(restartNeeded({ cliVersion: "2.1.286" }, status("2.1.290"))).toBe(true);
    expect(restartNeeded({ cliVersion: "2.1.290" }, status("2.1.290"))).toBe(false);
    expect(restartNeeded({ cliVersion: null }, status("2.1.290"))).toBe(false);
    expect(restartNeeded({ cliVersion: "2.1.286" }, undefined)).toBe(false);
  });
});
