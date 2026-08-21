import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { codexHistory } from "./codex";

describe("codexHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-codex-"));
  });

  function writeRollout(y: string, m: string, d: string, file: string, meta: object): void {
    const dir = join(home.dir, ".codex", "sessions", y, m, d);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, file),
      `${JSON.stringify(meta)}\n${JSON.stringify({ type: "event_msg" })}\n`,
    );
  }

  it("reads session_meta from the first line and matches the cwd", async () => {
    writeRollout("2026", "08", "18", "rollout-a.jsonl", {
      timestamp: "2026-08-18T14:12:53.019Z",
      type: "session_meta",
      payload: {
        session_id: "019f8b75",
        cwd: REPO,
        timestamp: "2026-08-18T14:10:00.000Z",
        cli_version: "0.144.3",
      },
    });
    writeRollout("2026", "08", "18", "rollout-b.jsonl", {
      type: "session_meta",
      payload: { session_id: "other", cwd: "/elsewhere" },
    });

    const sessions = await codexHistory.list([REPO], 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "codex",
      sessionId: "019f8b75",
      version: "0.144.3",
      title: null, // codex records none — inventing one would be a lie
    });
  });

  // ~750 rollouts accumulate; the date is in the PATH, so a window prunes whole
  // directories instead of opening every file.
  it("skips day directories outside the window without opening them", async () => {
    writeRollout("2020", "01", "01", "rollout-old.jsonl", {
      type: "session_meta",
      payload: { session_id: "old", cwd: REPO },
    });
    const since = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);
    expect(await codexHistory.list([REPO], since)).toEqual([]);
  });

  // Found against the real store: session_meta embeds the model's full
  // base_instructions, so the first line runs 15-22 KB. Reading a short head
  // truncated it, JSON.parse failed, and every codex session vanished silently.
  it("reads a session_meta line far larger than a typical JSON line", async () => {
    writeRollout("2026", "08", "18", "rollout-big.jsonl", {
      type: "session_meta",
      payload: {
        session_id: "big",
        cwd: REPO,
        base_instructions: { text: "x".repeat(20_000) },
        git: { branch: "main" },
      },
    });

    const sessions = await codexHistory.list([REPO], 0);
    expect(sessions.map((s) => s.sessionId)).toContain("big");
    expect(sessions.find((s) => s.sessionId === "big")?.branch).toBe("main");
  });

  // codex writes a rollout per internal guardian assessment too — four of every
  // six on this machine. Listed, they bury the real sessions under near-
  // identical rows.
  it("skips codex's own subagent rollouts", async () => {
    writeRollout("2026", "08", "18", "rollout-guardian.jsonl", {
      type: "session_meta",
      payload: {
        session_id: "guardian",
        cwd: REPO,
        thread_source: "subagent",
        source: { subagent: { other: "guardian" } },
      },
    });
    writeRollout("2026", "08", "18", "rollout-mine.jsonl", {
      type: "session_meta",
      payload: { session_id: "mine", cwd: REPO, thread_source: "user" },
    });

    const sessions = await codexHistory.list([REPO], 0);
    expect(sessions.map((s) => s.sessionId)).toEqual(["mine"]);
  });

  it("titles a rollout with the first thing the person actually typed", async () => {
    const dir = join(home.dir, ".codex", "sessions", "2026", "08", "18");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "rollout-titled.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { session_id: "titled", cwd: REPO, thread_source: "user" },
        }),
        // Everything codex injects before the person gets a word in.
        JSON.stringify({
          payload: {
            type: "message",
            role: "user",
            content: [{ text: "# AGENTS.md instructions\nblah" }],
          },
        }),
        JSON.stringify({
          payload: { type: "message", role: "developer", content: [{ text: "ignored" }] },
        }),
        JSON.stringify({
          payload: { type: "user_message", message: "arregla el login   por favor" },
        }),
      ].join("\n"),
    );

    const [session] = await codexHistory.list([REPO], 0);
    expect(session?.title).toBe("arregla el login por favor");
  });

  it("returns nothing when codex is not installed", async () => {
    expect(await codexHistory.list([REPO], 0)).toEqual([]);
  });
});
