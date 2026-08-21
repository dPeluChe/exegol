import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

import { gooseHistory } from "./goose";

describe("gooseHistory", () => {
  const REPO = "/Users/me/code/repo";

  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "exegol-goose-"));
  });

  function write(name: string, header: object): void {
    const dir = join(home.dir, ".local", "share", "goose", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), `${JSON.stringify(header)}\n{"role":"user"}\n`);
  }

  // goose's header is the richest of any CLI here: cwd, its own written summary,
  // and real token counts.
  it("reads the working dir and goose's own description", async () => {
    write("20250731_173343.jsonl", {
      working_dir: REPO,
      description: "Automatización   documentación con IA",
      message_count: 24,
      total_tokens: 19249,
    });
    write("20250731_180031.jsonl", { working_dir: "/elsewhere", description: "otro" });

    const sessions = await gooseHistory.list([REPO], 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "goose",
      sessionId: "20250731_173343",
      title: "Automatización documentación con IA",
      cwd: REPO,
    });
    // The filename is the only start time goose records.
    expect(sessions[0]?.startedAt).toBe(
      Math.floor(new Date("2025-07-31T17:33:43").getTime() / 1000),
    );
  });

  it("returns nothing when goose is not installed", async () => {
    expect(await gooseHistory.list([REPO], 0)).toEqual([]);
  });
});
