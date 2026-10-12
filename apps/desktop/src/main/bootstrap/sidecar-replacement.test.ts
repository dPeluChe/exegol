import { describe, expect, it } from "vitest";
import {
  buildReplacedInventory,
  type CrashContext,
  countReasons,
  crashReason,
  inventoryFileName,
} from "./sidecar-replacement";

const at = new Date("2026-10-12T18:30:05.123Z");

describe("sidecar replacement inventory", () => {
  it("lists every live session with its DB metadata, ids only for unknown ones", () => {
    const inv = buildReplacedInventory(
      { from: "1.6.0", to: "1.7.0", liveSessionIds: ["a", "ghost"] },
      [
        {
          id: "a",
          project_id: "p1",
          cli_type: "claude-code",
          alias: "Orion",
          pid: 123,
          status: "running",
        },
      ],
      at,
    );
    expect(inv).toEqual({
      replacedAt: "2026-10-12T18:30:05.123Z",
      from: "1.6.0",
      to: "1.7.0",
      sessions: [
        {
          agentId: "a",
          projectId: "p1",
          cliType: "claude-code",
          alias: "Orion",
          pid: 123,
          status: "running",
        },
        { agentId: "ghost", projectId: null, cliType: null, alias: null, pid: null, status: null },
      ],
    });
  });

  it("names the file by time, safe on every file system", () => {
    expect(inventoryFileName(at)).toBe("sidecar-replaced-2026-10-12T18-30-05-123Z.json");
  });
});

describe("crash reasons", () => {
  const base: CrashContext = {
    replaced: new Set(["r"]),
    dead: new Set(["d"]),
    failed: new Set(["f"]),
    sidecarConnected: true,
    sidecarSessionTotal: 3,
  };

  it("says why each agent came back crashed", () => {
    expect(crashReason("r", base)).toBe("sidecar replaced (version bump)");
    expect(crashReason("d", base)).toBe("PTY had exited in the sidecar");
    expect(crashReason("f", base)).toBe("reattach failed");
    expect(crashReason("x", base)).toBe("no session in the sidecar");
    expect(crashReason("x", { ...base, sidecarSessionTotal: 0 })).toMatch(/came back empty/);
    expect(crashReason("x", { ...base, sidecarConnected: false })).toBe("sidecar unavailable");
  });

  it("counts reasons for the summary line", () => {
    expect(countReasons(["a", "b", "a"])).toBe("a: 2, b: 1");
  });
});
