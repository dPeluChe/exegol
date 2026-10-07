import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { addDictation, hasDictations, listDictations, pruneDictations } from "./history";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe("dictation history", () => {
  let db: Database.Database;
  const add = (text: string, at: number, projectId: string | null = null) =>
    addDictation(
      db,
      { text, modelId: "m", durationMs: 1000, projectId, targetKind: "terminal" },
      at,
    );

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
  });

  it("lists newest first and keeps a deleted project out of the row", () => {
    add("first", NOW - 2000, "p1");
    add("second", NOW - 1000, "gone");
    expect(listDictations(db, 10).map((d) => [d.text, d.projectId])).toEqual([
      ["second", null],
      ["first", "p1"],
    ]);
    expect(hasDictations(db)).toBe(true);
  });

  it("drops entries older than the retention days", () => {
    add("old", NOW - 31 * DAY);
    add("recent", NOW - 29 * DAY);
    expect(pruneDictations(db, { days: 30, max: 500 }, NOW)).toBe(1);
    expect(listDictations(db, 10).map((d) => d.text)).toEqual(["recent"]);
  });

  it("keeps only the newest max entries", () => {
    for (let i = 0; i < 5; i++) add(`d${i}`, NOW - (5 - i) * 1000);
    expect(pruneDictations(db, { days: 30, max: 3 }, NOW)).toBe(2);
    expect(listDictations(db, 10).map((d) => d.text)).toEqual(["d4", "d3", "d2"]);
  });
});
