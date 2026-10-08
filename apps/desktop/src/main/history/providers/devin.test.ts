import { beforeEach, describe, expect, it, vi } from "vitest";

const listing = vi.hoisted(() => ({ entries: [] as unknown[], calls: [] as string[][] }));
vi.mock("../cli-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cli-list")>()),
  cliListing: async (_provider: string, command: string, args: string[], cwd: string) => {
    listing.calls.push([command, ...args, cwd]);
    return listing.entries;
  },
  realpathOr: async (p: string) => p,
}));

import { devinHistory, devinSessions } from "./devin";

const REPO = "/Users/me/code/repo";

// Shape verified against `devin list --format json` (2026-10-08)
const ENTRIES = [
  {
    id: "legend-fine",
    working_directory: REPO,
    last_activity_at: 1_782_408_760,
    title: "Revisión   del proyecto",
  },
  { id: "other", working_directory: "/elsewhere", last_activity_at: 1_782_408_760 },
];

describe("devinSessions", () => {
  it("keeps the sessions of this folder with devin's own title and last activity", () => {
    expect(devinSessions(ENTRIES, REPO, REPO, 0)).toEqual([
      expect.objectContaining({
        provider: "devin",
        sessionId: "legend-fine",
        title: "Revisión del proyecto",
        cwd: REPO,
        endedAt: 1_782_408_760,
      }),
    ]);
  });

  it("matches the realpath devin records for a symlinked cwd", () => {
    expect(devinSessions(ENTRIES, "/link/repo", REPO, 0)[0]?.cwd).toBe("/link/repo");
  });

  it("drops sessions older than the window", () => {
    expect(devinSessions(ENTRIES, REPO, REPO, 1_782_408_761)).toEqual([]);
  });
});

describe("devinHistory", () => {
  beforeEach(() => {
    listing.calls = [];
    listing.entries = ENTRIES;
  });

  it("runs devin's listing in each cwd", async () => {
    const sessions = await devinHistory.list([REPO], 0);
    expect(listing.calls).toEqual([["devin", "list", "--format", "json", REPO]]);
    expect(sessions.map((s) => s.sessionId)).toEqual(["legend-fine"]);
  });
});
