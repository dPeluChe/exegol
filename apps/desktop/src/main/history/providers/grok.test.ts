import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { grokHistory } from "./grok";

function writeSession(cwdFolder: string, id: string, summary: Record<string, unknown>): void {
  const dir = join(home.dir, ".grok", "sessions", cwdFolder, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary));
  writeFileSync(join(dir, "updates.jsonl"), "{}\n");
}

describe("grokHistory", () => {
  const REPO = "/Users/me/_code_/my-repo";
  const FOLDER = "%2FUsers%2Fme%2F_code_%2Fmy-repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-grok-"));
  });

  it("reads the session's summary, with microsecond timestamps", async () => {
    writeSession(FOLDER, "01a1a925-019b", {
      generated_title: "Fix the  login",
      head_branch: "main",
      created_at: "2026-11-05T00:38:57.248392Z",
      last_active_at: "2026-11-05T00:40:46.866260Z",
      num_chat_messages: 7,
    });
    writeFileSync(join(home.dir, ".grok", "sessions", FOLDER, "prompt_history.jsonl"), "{}\n");

    const sessions = await grokHistory.list([REPO], 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "grok",
      sessionId: "01a1a925-019b",
      title: "Fix the login",
      cwd: REPO,
      branch: "main",
      startedAt: Math.floor(Date.parse("2026-11-05T00:38:57.248Z") / 1000),
      endedAt: Math.floor(Date.parse("2026-11-05T00:40:46.866Z") / 1000),
    });
  });

  it("skips sessions with no prompt and those older than since", async () => {
    const at = "2026-11-05T00:40:46.866260Z";
    writeSession(FOLDER, "empty", { last_active_at: at, num_chat_messages: 0 });
    writeSession(FOLDER, "old", { last_active_at: at, num_chat_messages: 2 });

    const after = Date.parse(at) / 1000 + 60;
    expect(await grokHistory.list([REPO], after)).toEqual([]);
  });

  it("returns nothing for a folder Grok has never seen", async () => {
    writeSession("%2Fother", "s1", {
      last_active_at: "2026-11-05T00:40:46Z",
      num_chat_messages: 1,
    });
    expect(await grokHistory.list([REPO], 0)).toEqual([]);
  });
});
