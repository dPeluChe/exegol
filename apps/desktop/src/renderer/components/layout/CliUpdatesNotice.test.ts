import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/use-cli-updates", async () => {
  const { isNewerVersion } = await import("@exegol/shared");
  return {
    restartNeeded: (a: { cliVersion?: string | null }, s?: { installed: string | null }) =>
      isNewerVersion(s?.installed, a.cliVersion),
    updateAndRestart: vi.fn(),
    useCliUpdates: vi.fn(),
  };
});
vi.mock("../common/SessionChips", () => ({ SessionChips: vi.fn() }));
const { cliUpdateRows, rowsKey } = await import("./CliUpdatesNotice");

const status = (cliType: string, installed: string, latest: string | null, cmd: string | null) => ({
  cliType,
  installed,
  installedAt: null,
  latest,
  updateAvailable: !!latest && latest !== installed,
  updateCommand: cmd,
});

describe("cliUpdateRows", () => {
  it("lists CLIs with an update to install, or sessions behind an installed one", () => {
    const statuses = new Map([
      ["codex", status("codex", "0.155.1", "0.159.2", "codex update")],
      ["claude-code", status("claude-code", "2.1.290", "2.1.290", "claude update")],
      ["gemini", status("gemini", "0.62.0", "0.62.0", "npm i -g x")],
    ]);
    const agents = [
      { id: "c1", cliType: "codex", status: "running", cliVersion: "0.155.1" },
      { id: "a1", cliType: "claude-code", status: "waiting_input", cliVersion: "2.1.286" },
      { id: "a2", cliType: "claude-code", status: "idle", cliVersion: "2.1.290" },
      { id: "g1", cliType: "gemini", status: "running", cliVersion: "0.62.0" },
    ];
    const rows = cliUpdateRows(statuses, agents);
    expect(rows.map((r) => [r.status.cliType, r.sessions, r.behind])).toEqual([
      ["codex", ["c1"], []],
      ["claude-code", ["a1", "a2"], ["a1"]],
    ]);
  });

  it("an update without a command to run is not offered", () => {
    const rows = cliUpdateRows(new Map([["agy", status("agy", "1.0", "2.0", null)]]), []);
    expect(rows).toEqual([]);
  });

  it("dismissal is per version: restarting sessions one by one does not reopen it", () => {
    const s = status("claude-code", "2.1.290", "2.1.290", "claude update");
    expect(rowsKey([{ status: s }])).toBe("claude-code@2.1.290");
  });
});
