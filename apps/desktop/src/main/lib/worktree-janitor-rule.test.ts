import { describe, expect, it } from "vitest";
import {
  JANITOR_IDLE_MS,
  type JanitorFileLook,
  type JanitorGitLook,
  janitorGate,
  janitorVerdict,
  nextMark,
  sheddableDirs,
} from "./worktree-janitor-rule";

const NOW = 10 * JANITOR_IDLE_MS;
const OLD = NOW - 2 * JANITOR_IDLE_MS;
const look = (o: Partial<JanitorGitLook> = {}): JanitorGitLook => ({
  fingerprint: "abc\nreflog",
  clean: true,
  blocked: null,
  ...o,
});
const files = (o: Partial<JanitorFileLook> = {}): JanitorFileLook => ({
  newestMtimeMs: OLD,
  sheddable: ["node_modules"],
  ...o,
});
const prev = { fingerprint: "abc\nreflog", since: OLD };
const verdict = (o: Partial<Parameters<typeof janitorVerdict>[0]> = {}) =>
  janitorVerdict({ busy: false, git: look(), files: files(), prev, now: NOW, ...o });

describe("janitorVerdict", () => {
  it("sheds an idle, clean, unused worktree whose HEAD has not moved", () => {
    expect(verdict()).toEqual({ shed: true, dirs: ["node_modules"] });
  });

  it("keeps it when any rule fails", () => {
    expect(verdict({ busy: true })).toMatchObject({ reason: "in use" });
    expect(verdict({ git: look({ blocked: "operation in progress" }) })).toMatchObject({
      reason: "blocked",
    });
    expect(verdict({ git: look({ clean: false }) })).toMatchObject({
      reason: "uncommitted changes",
    });
    expect(verdict({ prev: undefined })).toMatchObject({ reason: "first look" });
    expect(verdict({ git: look({ fingerprint: "def\nreflog" }) })).toMatchObject({
      reason: "head moved",
    });
    expect(verdict({ prev: { ...prev, since: NOW - 3_600_000 } })).toMatchObject({
      reason: "not idle long enough",
    });
    expect(verdict({ files: files({ newestMtimeMs: NOW - 60_000 }) })).toMatchObject({
      reason: "files changed recently",
    });
    expect(verdict({ files: files({ sheddable: [] }) })).toMatchObject({
      reason: "nothing to free",
    });
  });

  it("counts a mark from the previous daily run as a full day", () => {
    const since = NOW - JANITOR_IDLE_MS + 5_000;
    expect(verdict({ prev: { ...prev, since } }).shed).toBe(true);
  });
});

describe("janitorGate", () => {
  it("decides from git alone, before any file is looked at", () => {
    expect(janitorGate({ busy: false, git: look(), prev, now: NOW })).toBeNull();
    expect(janitorGate({ busy: false, git: look(), prev: undefined, now: NOW })).toBe("first look");
  });
});

describe("nextMark", () => {
  it("keeps the first sighting while HEAD and reflog stay, restarts on a change", () => {
    expect(nextMark(prev, prev.fingerprint, NOW)).toBe(prev);
    expect(nextMark(prev, "other", NOW)).toEqual({ fingerprint: "other", since: NOW });
    expect(nextMark(undefined, "x", NOW)).toEqual({ fingerprint: "x", since: NOW });
  });
});

describe("sheddableDirs", () => {
  it("keeps only listed directory names, outermost first", () => {
    expect(
      sheddableDirs([
        "node_modules/",
        "apps/web/.next/",
        "apps/web/node_modules/",
        "apps/",
        ".env",
        "data/",
        "packages/x/dist",
        "target/",
        "py/__pycache__/",
        ".venv/",
      ]),
    ).toEqual([
      "node_modules",
      "apps/web/.next",
      "apps/web/node_modules",
      "target",
      "py/__pycache__",
      ".venv",
    ]);
  });

  it("never a path that escapes or holds .git", () => {
    expect(sheddableDirs(["../node_modules/", "/node_modules/", ".git/dist/", "a//dist/"])).toEqual(
      [],
    );
  });

  it("skips one nested in another listed dir", () => {
    expect(sheddableDirs(["node_modules/x/dist/"])).toEqual([]);
  });
});
