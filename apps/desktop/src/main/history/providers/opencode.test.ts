import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { opencodeHistory } from "./opencode";

describe("opencodeHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-oc-"));
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
});
