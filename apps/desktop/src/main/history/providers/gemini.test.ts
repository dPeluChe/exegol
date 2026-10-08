import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { geminiHistory } from "./gemini";

describe("geminiHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-gemini-"));
  });

  function writeChat(file: string, chat: object): void {
    // The sha256 of the cwd is the ONLY link to a repo — nothing inside names it.
    const dir = join(
      home.dir,
      ".gemini",
      "tmp",
      createHash("sha256").update(REPO).digest("hex"),
      "chats",
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(chat));
  }

  it("titles a chat with the first user message, skipping the CLI's own notices", async () => {
    writeChat("session-a.json", {
      sessionId: "sess-a",
      startTime: "2026-02-12T19:36:26.857Z",
      lastUpdated: "2026-02-12T20:00:00.000Z",
      messages: [
        { type: "info", content: "Gemini CLI update available! 0.27.2 → 0.28.2" },
        { type: "user", content: "arregla   el login" },
      ],
    });

    const [session] = await geminiHistory.list([REPO], 0);
    expect(session).toMatchObject({
      provider: "gemini",
      sessionId: "sess-a",
      title: "arregla el login",
    });
  });

  // gemini reuses a session id across resumes, one file each — left separate
  // they are duplicate rows that collide on the id the timeline keys by.
  it("collapses resumed chats of one session into a single row", async () => {
    writeChat("session-first.json", {
      sessionId: "sess-b",
      startTime: "2026-02-12T10:00:00.000Z",
      lastUpdated: "2026-02-12T10:30:00.000Z",
      messages: [{ type: "user", content: "la pregunta original" }],
    });
    writeChat("session-resumed.json", {
      sessionId: "sess-b",
      startTime: "2026-02-13T10:00:00.000Z",
      lastUpdated: "2026-02-13T11:00:00.000Z",
      messages: [{ type: "user", content: "seguimos" }],
    });

    const sessions = await geminiHistory.list([REPO], 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe("la pregunta original");
    expect(sessions[0]?.endedAt).toBe(Math.floor(Date.parse("2026-02-13T11:00:00.000Z") / 1000));
  });

  it("returns nothing for a repo gemini has never seen", async () => {
    expect(await geminiHistory.list(["/other/repo"], 0)).toEqual([]);
  });

  // gemini 0.4x+: `tmp/<slug from projects.json>/chats/*.jsonl`, header on line 1
  it("reads the slug-dir JSONL layout, skipping a chat with no user message", async () => {
    const gem = join(home.dir, ".gemini");
    mkdirSync(join(gem, "tmp", "repo", "chats"), { recursive: true });
    writeFileSync(join(gem, "projects.json"), JSON.stringify({ projects: { [REPO]: "repo" } }));
    const header = (id: string) =>
      JSON.stringify({ sessionId: id, startTime: "2026-06-18T18:38:53.870Z", kind: "main" });
    writeFileSync(
      join(gem, "tmp", "repo", "chats", "session-a.jsonl"),
      `${header("sess-j")}\n${JSON.stringify({ type: "user", content: [{ text: "hola  gemini" }] })}\n`,
    );
    writeFileSync(
      join(gem, "tmp", "repo", "chats", "session-empty.jsonl"),
      `${header("sess-e")}\n`,
    );

    const sessions = await geminiHistory.list([REPO], 0);
    expect(sessions).toEqual([
      expect.objectContaining({ sessionId: "sess-j", title: "hola gemini", cwd: REPO }),
    ]);
  });
});
