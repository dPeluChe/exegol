import { beforeEach, describe, expect, it, vi } from "vitest";

const listing = vi.hoisted(() => ({
  run: vi.fn<(cmd: string, args: string[], cwd: string) => Promise<string>>(),
}));
vi.mock("../cli-list", () => ({
  runCliListing: listing.run,
  realpathOr: async (p: string) => p,
}));

import { devinHistory, parseDevinList } from "./devin";

const REPO = "/Users/me/code/repo";

// Shape verified against `devin list --format json` (2026-10-08)
const OUTPUT = JSON.stringify([
  {
    id: "legend-fine",
    short_id: "legend-fine",
    working_directory: REPO,
    working_directory_display: "./",
    last_activity_at: 1_782_408_760,
    last_activity_ago: "105d ago",
    title: "Revisión   del proyecto",
  },
  { id: "other", working_directory: "/elsewhere", last_activity_at: 1_782_408_760 },
]);

describe("parseDevinList", () => {
  it("keeps the sessions of this folder with devin's own title and last activity", () => {
    const sessions = parseDevinList(OUTPUT, REPO, REPO, 0);
    expect(sessions).toEqual([
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
    expect(parseDevinList(OUTPUT, "/link/repo", REPO, 0)[0]?.cwd).toBe("/link/repo");
  });

  it("drops sessions older than the window", () => {
    expect(parseDevinList(OUTPUT, REPO, REPO, 1_782_408_761)).toEqual([]);
  });

  it("reads an empty folder as no sessions", () => {
    expect(parseDevinList("[]\n", REPO, REPO, 0)).toEqual([]);
    expect(parseDevinList("", REPO, REPO, 0)).toEqual([]);
  });
});

describe("devinHistory", () => {
  beforeEach(() => listing.run.mockReset());

  it("runs the listing in each cwd", async () => {
    listing.run.mockResolvedValue(OUTPUT);
    const sessions = await devinHistory.list([REPO], 0);
    expect(listing.run).toHaveBeenCalledWith("devin", ["list", "--format", "json"], REPO);
    expect(sessions.map((s) => s.sessionId)).toEqual(["legend-fine"]);
  });
});
