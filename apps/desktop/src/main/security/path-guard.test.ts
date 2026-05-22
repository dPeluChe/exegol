import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafePath,
  hasAdsSuffix,
  hasBidiChars,
  isPathAllowed,
  isPathInside,
  isSensitivePath,
  PathGuardError,
} from "./path-guard";

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
    const evil = `${tmpDir}EVIL`;
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

  it("blocks a symlink inside the project pointing outside (symlink escape)", async () => {
    // /project/evil-link -> /etc
    // accessing /project/evil-link/passwd should be denied even though
    // /project is the allowed base
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const projectDir = join(tmpDir, "project");
    const externalDir = join(tmpDir, "external-secret");
    const { mkdir } = await import("node:fs/promises");
    await Promise.all([mkdir(projectDir), mkdir(externalDir)]);

    const evilLink = join(projectDir, "evil-link");
    await symlink(externalDir, evilLink);

    // path that traverses through the symlink
    const escapedPath = join(evilLink, "secret.txt");
    expect(await isPathAllowed(escapedPath, [projectDir])).toBe(false);
  });

  it("blocks creating a file via a symlink that escapes the project", async () => {
    // Same as above but for a non-existent target (write scenario)
    tmpDir = await mkdtemp(join(tmpdir(), "pg-test-"));
    const projectDir = join(tmpDir, "project");
    const externalDir = join(tmpDir, "external");
    const { mkdir } = await import("node:fs/promises");
    await Promise.all([mkdir(projectDir), mkdir(externalDir)]);

    const evilLink = join(projectDir, "link-out");
    await symlink(externalDir, evilLink);

    // new.txt does not exist yet — write scenario
    const newFile = join(evilLink, "new.txt");
    expect(await isPathAllowed(newFile, [projectDir])).toBe(false);
  });
});

// ─── hasBidiChars ────────────────────────────────────────────────────────────

describe("hasBidiChars", () => {
  it.each([
    // U+202A LRE
    ["file‪hidden.ts"],
    // U+202E RLO — classic Trojan Source
    ["fi‮le.ts"],
    // U+2066 LRI
    ["dir/⁦inner/file"],
    // U+2069 PDI
    ["x⁩.txt"],
    // U+200E LRM — directional mark, also abused in Trojan Source
    ["safe‎config.ts"],
    // U+200F RLM
    ["safe‏key.pem"],
    // U+061C ALM
    ["auth؜key.pem"],
  ])("detects bidi chars in %p", (input) => {
    expect(hasBidiChars(input)).toBe(true);
  });

  it.each([
    "plain/path/file.ts",
    "with-dashes_and.dots/x.txt",
    "/users/me/projects/myapp/src/main.ts",
  ])("allows clean names: %p", (input) => {
    expect(hasBidiChars(input)).toBe(false);
  });
});

// ─── hasAdsSuffix ────────────────────────────────────────────────────────────

describe("hasAdsSuffix", () => {
  // ADS only exists on Windows; this whole helper short-circuits on POSIX so a
  // legitimate timestamped filename containing `:` is never refused on
  // macOS/Linux. The Windows-side checks are exercised only when the test runs
  // on Windows.
  const isWin = process.platform === "win32";

  it("on POSIX, returns false for any path (including ISO timestamps)", () => {
    if (isWin) return;
    expect(hasAdsSuffix("/repo/logs/2026-05-21T10:00:00.log")).toBe(false);
    expect(hasAdsSuffix("file.txt:hidden_stream")).toBe(false);
    expect(hasAdsSuffix("/home/user/project/file.ts")).toBe(false);
  });

  it("on Windows, detects an ADS suffix", () => {
    if (!isWin) return;
    expect(hasAdsSuffix("file.txt:hidden_stream")).toBe(true);
    expect(hasAdsSuffix("/projects/app/secrets.json:$DATA")).toBe(true);
  });

  it("on Windows, ignores the drive-letter colon", () => {
    if (!isWin) return;
    expect(hasAdsSuffix("C:/projects/app/src/main.ts")).toBe(false);
    expect(hasAdsSuffix("D:\\work\\file.txt")).toBe(false);
  });
});

// ─── isSensitivePath ─────────────────────────────────────────────────────────

describe("isSensitivePath", () => {
  it.each([
    ".env",
    "/projects/app/.env",
    "/projects/app/.env.local",
    "/projects/app/.env.production",
    "/home/me/.netrc",
    "/home/me/.npmrc",
    "/home/me/.ssh/id_rsa",
    "/home/me/.ssh/config",
    "/home/me/.aws/credentials",
    "/home/me/.gnupg/private-keys-v1.d/key.key",
    "/home/me/.config/gh/hosts.yml",
    "/users/me/library/keychains/login.keychain-db",
    "/home/me/.kube/config",
    "/private/var/db/something",
    "/projects/app/server.pem",
    "/projects/app/cert.key",
    // newly covered patterns
    "/projects/app/service-account.json",
    "/projects/app/service_account_prod.json",
    "/projects/app/client_secret_xxxxx.apps.googleusercontent.com.json",
    "/projects/app/secrets.json",
    "/projects/app/secrets.yml",
    "/projects/app/secret.env",
    "/home/me/.gitconfig",
    "/home/me/.dockercfg",
    "/home/me/.terraformrc",
    "/home/me/.cargo/credentials",
    "/home/me/.config/git/credentials",
    "/projects/app/release.asc",
    "/projects/app/release.gpg",
    "/projects/app/store.jks",
  ])("refuses sensitive path: %p", (input) => {
    expect(isSensitivePath(input)).toBe(true);
  });

  it.each([
    "/projects/app/src/main.ts",
    "/projects/app/README.md",
    // .sshx must NOT collide with .ssh
    "/projects/app/.sshx/config",
    "/projects/app/logs/.envcheck.log",
    "/projects/app/keys-readme.md",
    // ISO-8601 timestamps in filenames are common; must not trip ADS-shaped
    // checks on POSIX (hasAdsSuffix is platform-gated; isSensitivePath has no
    // ADS check at all). Both should pass.
    "/projects/app/logs/2026-05-21T10:00:00.log",
  ])("allows benign path: %p", (input) => {
    expect(isSensitivePath(input)).toBe(false);
  });
});

// ─── assertSafePath ──────────────────────────────────────────────────────────

describe("assertSafePath", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the canonical path on success", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const target = join(tmpDir, "src", "main.ts");
    const canonical = await assertSafePath(target, { allowedBases: [tmpDir] });
    // realpath may rewrite /tmp -> /private/tmp on macOS; just check it ends correctly
    expect(canonical.endsWith(join("src", "main.ts"))).toBe(true);
  });

  it("refuses bidi chars with reason 'bidi-chars'", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const bad = join(tmpDir, "bad‮name.ts");
    await expect(assertSafePath(bad, { allowedBases: [tmpDir] })).rejects.toMatchObject({
      name: "PathGuardError",
      reason: "bidi-chars",
    });
  });

  it("refuses ADS suffix with reason 'ads-suffix' (Windows only)", async () => {
    if (process.platform !== "win32") return;
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const bad = join(tmpDir, "file.txt:hidden");
    await expect(assertSafePath(bad, { allowedBases: [tmpDir] })).rejects.toMatchObject({
      name: "PathGuardError",
      reason: "ads-suffix",
    });
  });

  it("refuses sensitive path with reason 'sensitive-path'", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const bad = join(tmpDir, ".env.production");
    await expect(assertSafePath(bad, { allowedBases: [tmpDir] })).rejects.toMatchObject({
      name: "PathGuardError",
      reason: "sensitive-path",
    });
  });

  it("refuses path outside allowed bases with reason 'outside-allowed-bases'", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const otherBase = await mkdtemp(join(tmpdir(), "pg-other-"));
    try {
      const bad = join(otherBase, "file.ts");
      await expect(assertSafePath(bad, { allowedBases: [tmpDir] })).rejects.toMatchObject({
        name: "PathGuardError",
        reason: "outside-allowed-bases",
      });
    } finally {
      await rm(otherBase, { recursive: true, force: true });
    }
  });

  it("refuses a symlink that resolves to a sensitive location", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    const projectDir = join(tmpDir, "project");
    const fakeSshDir = join(tmpDir, ".ssh");
    await Promise.all([mkdir(projectDir), mkdir(fakeSshDir)]);
    await writeFile(join(fakeSshDir, "id_rsa"), "");
    // Inside the project, create a symlink that points into a sensitive dir.
    const trojan = join(projectDir, "innocent.txt");
    await symlink(join(fakeSshDir, "id_rsa"), trojan);
    await expect(assertSafePath(trojan, { allowedBases: [projectDir] })).rejects.toMatchObject({
      name: "PathGuardError",
      reason: "sensitive-path",
    });
  });

  it("throws PathGuardError instances with a path field", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pg-assert-"));
    const bad = join(tmpDir, ".env");
    try {
      await assertSafePath(bad, { allowedBases: [tmpDir] });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(PathGuardError);
      const e = err as PathGuardError;
      expect(e.reason).toBe("sensitive-path");
      expect(e.path).toBe(bad);
    }
  });
});
