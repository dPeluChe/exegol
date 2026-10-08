import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

/** null = opencode not installed */
const listing = vi.hoisted(() => ({ entries: null as unknown[] | null, calls: [] as string[][] }));
vi.mock("../cli-list", async () => {
  const { StoreUnavailable } = await import("../types");
  return {
    cliListing: async (_provider: string, command: string, args: string[], cwd: string) => {
      listing.calls.push([command, ...args, cwd]);
      if (!listing.entries) throw new StoreUnavailable("opencode not installed");
      return listing.entries;
    },
    realpathOr: async (p: string) => p,
  };
});

import { opencodeHistory } from "./opencode";

describe("opencodeHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-oc-"));
    listing.entries = null;
    listing.calls = [];
  });

  function writeSession(projectHash: string, file: string, body: object): void {
    const dir = join(home.dir, ".local", "share", "opencode", "storage", "session", projectHash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(body));
  }

  it("matches on the recorded directory, not on the project hash", async () => {
    writeSession("hash-a", "ses_1.json", {
      id: "ses_1",
      version: "0.14.1",
      directory: REPO,
      title: "Killing server processes",
      time: { created: 1_759_538_396_945, updated: 1_759_541_746_481 },
    });
    writeSession("hash-b", "ses_2.json", { id: "ses_2", directory: "/elsewhere", title: "other" });

    const sessions = await opencodeHistory.list([REPO], 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "opencode",
      sessionId: "ses_1",
      title: "Killing server processes",
      // Stored in milliseconds; the timeline works in seconds.
      startedAt: 1_759_538_396,
      endedAt: 1_759_541_746,
    });
  });

  it("ignores a session outside the window and a corrupt file", async () => {
    writeSession("hash-a", "ses_old.json", {
      id: "ses_old",
      directory: REPO,
      time: { created: 1000, updated: 2000 },
    });
    const dir = join(home.dir, ".local", "share", "opencode", "storage", "session", "hash-a");
    writeFileSync(join(dir, "broken.json"), "{not json");

    expect(await opencodeHistory.list([REPO], 3000)).toEqual([]);
  });

  it("returns nothing when opencode is not installed", async () => {
    expect(await opencodeHistory.list([REPO], 0)).toEqual([]);
  });

  // opencode 1.x: SQLite store, read through its own listing (shape verified 2026-10-08)
  it("reads opencode's own listing when it is installed, keeping this folder's sessions", async () => {
    listing.entries = [
      {
        id: "ses_new",
        title: "Saludo rápido",
        updated: 1_790_808_584_874,
        created: 1_790_808_551_871,
        directory: REPO,
      },
      // Same git project, a worktree Exegol did not ask about
      { id: "ses_wt", updated: 1_790_808_584_874, directory: "/wt/other" },
    ];
    const sessions = await opencodeHistory.list([REPO, "/wt/mine"], 0);
    // One run covers the project's worktrees too
    expect(listing.calls).toEqual([
      ["opencode", "session", "list", "--format", "json", "--pure", REPO],
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: "ses_new",
        cwd: REPO,
        startedAt: 1_790_808_551,
        endedAt: 1_790_808_584,
      }),
    ]);
  });
});
