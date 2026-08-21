import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { droidHistory } from "./droid";

describe("droidHistory", () => {
  const REPO = "/Users/me/_code_/labs_irma";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-droid-"));
  });

  // droid replaces ONLY `/`, unlike Claude Code which also replaces `_`.
  // Assuming the two matched found nothing at all.
  it("slugs slashes but keeps underscores", async () => {
    const dir = join(home.dir, ".factory", "sessions", "-Users-me-_code_-labs_irma");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "abc.jsonl"),
      [
        JSON.stringify({ type: "session_start", id: "sess-1", title: "revisa la config" }),
        JSON.stringify({ type: "message", timestamp: "2026-08-18T10:00:00.000Z" }),
      ].join("\n"),
    );

    const [session] = await droidHistory.list([REPO], 0);
    expect(session).toMatchObject({
      provider: "factory-droid",
      sessionId: "sess-1",
      title: "revisa la config",
    });
    expect(session?.startedAt).toBe(Math.floor(Date.parse("2026-08-18T10:00:00.000Z") / 1000));
  });

  it("returns nothing for a repo droid has never seen", async () => {
    expect(await droidHistory.list([REPO], 0)).toEqual([]);
  });
});
