import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));
vi.mock("../db/queries", () => ({ getAgent: vi.fn() }));
vi.mock("../system/cli-versions", () => ({ installedCliVersion: vi.fn() }));

import { getAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { installedCliVersion } from "../system/cli-versions";
import { detectCliSelfUpdate } from "./cli-self-update";

const agent = { id: "a1", projectId: "p1", cliType: "codex" };
const db = {} as never;

describe("detectCliSelfUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a CLI that is another version after exiting, reading it fresh", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.161.0" } as never);
    vi.mocked(installedCliVersion).mockResolvedValue("0.162.1");
    expect(await detectCliSelfUpdate(db, agent)).toBe("0.162.1");
    expect(installedCliVersion).toHaveBeenCalledWith("codex", true);
    expect(broadcast).toHaveBeenCalledWith("agent:cli-self-updated", {
      agentId: "a1",
      projectId: "p1",
      cliType: "codex",
      from: "0.161.0",
      to: "0.162.1",
    });
  });

  it("stays quiet for a plain exit on the same version", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: "0.162.1" } as never);
    vi.mocked(installedCliVersion).mockResolvedValue("0.162.1");
    expect(await detectCliSelfUpdate(db, agent)).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("needs the version recorded at spawn", async () => {
    vi.mocked(getAgent).mockReturnValue({ cliVersion: null } as never);
    expect(await detectCliSelfUpdate(db, agent)).toBeNull();
    expect(installedCliVersion).not.toHaveBeenCalled();
  });
});
