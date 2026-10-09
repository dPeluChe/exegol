import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));
vi.mock("../db/queries", () => ({ getAgent: vi.fn() }));
vi.mock("../system/cli-versions", () => ({ runningCliBinary: vi.fn() }));

import { getAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { runningCliBinary } from "../system/cli-versions";
import { detectCliSelfUpdate } from "./cli-self-update";

const agent = { id: "a1", projectId: "p1", cliType: "codex" };
const db = {} as never;

describe("detectCliSelfUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  const started = 1_700_000_000;
  const rewritten = { version: "0.162.1", changedAtMs: (started + 60) * 1000 };

  it("reports a CLI rewritten during the session that is another version", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.161.0", startedAt: started } as never);
    vi.mocked(runningCliBinary).mockResolvedValue(rewritten);
    expect(await detectCliSelfUpdate(db, agent, 0)).toBe("0.162.1");
    expect(runningCliBinary).toHaveBeenCalledWith("codex");
    expect(broadcast).toHaveBeenCalledWith("agent:cli-self-updated", {
      agentId: "a1",
      projectId: "p1",
      cliType: "codex",
      from: "0.161.0",
      to: "0.162.1",
    });
  });

  it("stays quiet for a plain exit on the same version", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.162.1", startedAt: started } as never);
    vi.mocked(runningCliBinary).mockResolvedValue(rewritten);
    expect(await detectCliSelfUpdate(db, agent, 0)).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("stays quiet for a non-zero exit without reading the binary", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.161.0", startedAt: started } as never);
    expect(await detectCliSelfUpdate(db, agent, 1)).toBeNull();
    expect(runningCliBinary).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("stays quiet when the upgrade happened before the session started", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.161.0", startedAt: started } as never);
    vi.mocked(runningCliBinary).mockResolvedValue({
      version: "0.162.1",
      changedAtMs: (started - 3600) * 1000,
    });
    expect(await detectCliSelfUpdate(db, agent, 0)).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("needs the version recorded at spawn", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: null, startedAt: started } as never);
    expect(await detectCliSelfUpdate(db, agent, 0)).toBeNull();
    expect(runningCliBinary).not.toHaveBeenCalled();
  });
});
