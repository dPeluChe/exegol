import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { claudeCodeHistory } from "./claude-code";

// The transcript format is Claude Code's, not ours: a silent change here does
// not throw, it means the repo's history quietly loses a whole provider.
describe("claudeCodeHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-history-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function writeTranscript(name: string, lines: object[]): void {
    const dir = join(home.dir, ".claude", "projects", REPO.replace(/\//g, "-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), lines.map((l) => JSON.stringify(l)).join("\n"));
  }

  it("reads the AI title, branch, version and start time out of the head", async () => {
    writeTranscript("sess-1.jsonl", [
      { type: "mode", mode: "normal", sessionId: "sess-1" },
      {
        type: "user",
        cwd: REPO,
        gitBranch: "main",
        version: "2.1.0",
        timestamp: "2026-08-18T10:00:00.000Z",
        message: { content: "arregla el login" },
      },
      { type: "ai-title", aiTitle: "Fixing the login flow", sessionId: "sess-1" },
    ]);

    const [session] = await claudeCodeHistory.list([REPO], 0);
    expect(session).toMatchObject({
      provider: "claude-code",
      sessionId: "sess-1",
      title: "Fixing the login flow",
      branch: "main",
      version: "2.1.0",
      cwd: REPO,
    });
    expect(session?.startedAt).toBe(Math.floor(Date.parse("2026-08-18T10:00:00.000Z") / 1000));
  });

  it("falls back to the first prompt when the session never earned a title", async () => {
    writeTranscript("sess-2.jsonl", [
      { type: "mode", mode: "normal" },
      { type: "user", cwd: REPO, message: { content: [{ type: "text", text: "hola" }] } },
    ]);

    const [session] = await claudeCodeHistory.list([REPO], 0);
    expect(session?.title).toBe("hola");
  });

  it("survives a truncated tail — only a prefix of the file is read", async () => {
    const dir = join(home.dir, ".claude", "projects", REPO.replace(/\//g, "-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sess-3.jsonl"),
      `${JSON.stringify({ type: "ai-title", aiTitle: "kept" })}\n{"type":"user","cwd":`,
    );

    const [session] = await claudeCodeHistory.list([REPO], 0);
    expect(session?.title).toBe("kept");
  });

  // Found against the real store: `_code_` in a path becomes `--code--` on
  // disk, so slugging only `/` looked in a directory that does not exist and
  // reported zero sessions for a repo that had them.
  it("slugs underscores as well as slashes", async () => {
    const underscored = "/Users/me/_code_/repo";
    const dir = join(home.dir, ".claude", "projects", "-Users-me--code--repo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sess-u.jsonl"),
      JSON.stringify({ type: "user", cwd: underscored, message: { content: "hola" } }),
    );

    const [session] = await claudeCodeHistory.list([underscored], 0);
    expect(session?.sessionId).toBe("sess-u");
  });

  // That encoding is lossy: `_code_` and `-code-` land on the same directory.
  it("rejects a transcript whose recorded cwd is a different repo", async () => {
    writeTranscript("foreign.jsonl", [
      { type: "user", cwd: "/Users/me/code/OTHER", message: { content: "hola" } },
    ]);
    expect(await claudeCodeHistory.list([REPO], 0)).toEqual([]);
  });

  it("returns nothing for a directory the CLI has never seen", async () => {
    expect(await claudeCodeHistory.list(["/some/other/repo"], 0)).toEqual([]);
  });

  it("skips transcripts older than the window without reading them", async () => {
    writeTranscript("old.jsonl", [{ type: "ai-title", aiTitle: "ancient" }]);
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(await claudeCodeHistory.list([REPO], future)).toEqual([]);
  });
});
