import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPathAllowed, isPathInside } from "./path-guard";

// ─── isPathInside (sync, no I/O) ──────────────────────────────────────────────

describe("isPathInside", () => {
  const base = "/projects/myapp";

  it("allows exact base match", () => {
    expect(isPathInside(base, base)).toBe(true);
  });

  it("allows a direct child", () => {
    expect(isPathInside(base, "/projects/myapp/src/index.ts")).toBe(true);
  });

  it("allows a deeply nested child", () => {
    expect(isPathInside(base, "/projects/myapp/a/b/c/d.ts")).toBe(true);
  });

  it("blocks a path with the same prefix (prefix-confusion attack)", () => {
    // startsWith would incorrectly allow this
    expect(isPathInside(base, "/projects/myapp-evil")).toBe(false);
    expect(isPathInside(base, "/projects/myapp-evil/src")).toBe(false);
  });

  it("blocks a sibling directory", () => {
    expect(isPathInside(base, "/projects/other")).toBe(false);
  });

  it("blocks a parent directory", () => {
    expect(isPathInside(base, "/projects")).toBe(false);
    expect(isPathInside(base, "/")).toBe(false);
  });

  it("blocks path traversal attempts", () => {
    // resolve() normalizes these before relative() runs
    expect(isPathInside(base, resolve(base, "../../etc/passwd"))).toBe(false);
    expect(isPathInside(base, "/etc/passwd")).toBe(false);
  });

  it("blocks an absolute path that is unrelated", () => {
    expect(isPathInside(base, "/home/user/.ssh/id_rsa")).toBe(false);
  });
});

// ─── isPathAllowed (async, tests symlink resolution) ─────────────────────────

describe("isPathAllowed", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("allows a real path inside an allowed base", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const allowed = await isPathAllowed(join(tmpDir, "src", "file.ts"), [tmpDir]);
    expect(allowed).toBe(true);
  });

  it("denies a path outside all allowed bases", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const allowed = await isPathAllowed("/etc/passwd", [tmpDir]);
    expect(allowed).toBe(false);
  });

  it("denies a prefix-confusion path", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    // tmpDir might be /tmp/pg-test-abc; check that /tmp/pg-test-abcEVIL is blocked
    const evil = tmpDir + "EVIL";
    const allowed = await isPathAllowed(join(evil, "secret"), [tmpDir]);
    expect(allowed).toBe(false);
  });

  it("resolves symlinks on the base to defeat symlink traversal", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const realBase = join(tmpDir, "project");
    const symlinkBase = join(tmpDir, "link");
    // create a real dir and a symlink pointing to it
    await import("node:fs/promises").then((fs) => fs.mkdir(realBase));
    await symlink(realBase, symlinkBase);

    // file is inside realBase — both via real path and via symlink path should be allowed
    const fileInside = join(realBase, "src", "index.ts");
    expect(await isPathAllowed(fileInside, [symlinkBase])).toBe(true);
    expect(await isPathAllowed(fileInside, [realBase])).toBe(true);
  });

  it("allows path when one of multiple bases matches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const base1 = join(tmpDir, "project1");
    const base2 = join(tmpDir, "project2");
    await import("node:fs/promises").then((fs) => Promise.all([fs.mkdir(base1), fs.mkdir(base2)]));
    const file = join(base2, "src", "main.ts");
    expect(await isPathAllowed(file, [base1, base2])).toBe(true);
  });

  it("denies when no base matches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const base1 = join(tmpDir, "project1");
    const base2 = join(tmpDir, "project2");
    const outsideFile = join(tmpDir, "other", "secret.ts");
    expect(await isPathAllowed(outsideFile, [base1, base2])).toBe(false);
  });
});
