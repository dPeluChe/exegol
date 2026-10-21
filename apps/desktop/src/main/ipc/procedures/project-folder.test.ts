import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../db/migrations";
import { findProjectAt, folderKey, inspectFolder, sameFolder } from "./project-folder";

vi.mock("../../agents/spawn-env", () => ({ coreRust: null }));

const { projectRouter } = await import("./projects");

const tmp = mkdtempSync(join(tmpdir(), "exegol-addproj-"));
const repo = join(tmp, "repo");
const plain = join(tmp, "plain");
mkdirSync(join(repo, "web"), { recursive: true });
mkdirSync(plain);
execFileSync("git", ["init", "-q"], { cwd: repo });
symlinkSync(repo, join(tmp, "link"));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("folderKey", () => {
  it("drops trailing separators and keeps the root", () => {
    expect(folderKey("/a/b/", "linux")).toBe("/a/b");
    expect(folderKey("/", "linux")).toBe("/");
  });

  it("ignores case on macOS and Windows only", () => {
    expect(folderKey("/Users/Me/App", "darwin")).toBe(folderKey("/users/me/app/", "darwin"));
    expect(folderKey("/Users/Me/App", "linux")).not.toBe(folderKey("/users/me/app", "linux"));
    expect(folderKey("C:/Code/App\\", "win32")).toBe(folderKey("\\\\?\\c:\\code\\app", "win32"));
  });
});

describe("findProjectAt", () => {
  const projects = [{ id: "p1", name: "Repo", path: repo }];

  it("matches the same folder through a trailing slash or a symlink", async () => {
    expect((await findProjectAt(projects, `${repo}/`))?.id).toBe("p1");
    expect((await findProjectAt(projects, join(tmp, "link")))?.id).toBe("p1");
    expect(await findProjectAt(projects, join(repo, "web"))).toBeUndefined();
  });
});

describe("inspectFolder", () => {
  it("tells a repo, a folder inside one and a folder with no repo apart", async () => {
    expect(await inspectFolder(repo, [])).toEqual({ exists: true, isDirectory: true, git: "repo" });
    const sub = await inspectFolder(join(repo, "web"), []);
    expect(sub.git).toBe("subfolder");
    expect(await sameFolder(sub.toplevel ?? "", repo)).toBe(true);
    expect((await inspectFolder(plain, [])).git).toBe("none");
  });

  it("reports a missing folder and the project already there", async () => {
    expect(await inspectFolder(join(tmp, "nope"), [])).toMatchObject({ exists: false });
    expect(
      (await inspectFolder(repo, [{ id: "p1", name: "Repo", path: repo }])).existingProject,
    ).toEqual({ id: "p1", name: "Repo" });
  });
});

describe("projects.create", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const caller = projectRouter.createCaller({ db } as never);
  const base = { gitRemote: null, defaultBranch: "main" };

  it("refuses a folder that is already a project with a CONFLICT naming it", async () => {
    await caller.create({ ...base, name: "Repo", path: repo });
    await expect(caller.create({ ...base, name: "Again", path: `${repo}/` })).rejects.toMatchObject(
      { code: "CONFLICT", message: "Already in Exegol as 'Repo'" },
    );
  });

  it("adds a folder with no repo only when asked to git init it, on a valid branch", async () => {
    await expect(caller.create({ ...base, name: "Plain", path: plain })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.create({
        ...base,
        defaultBranch: "bad..name",
        name: "Plain",
        path: plain,
        initGit: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(existsSync(join(plain, ".git"))).toBe(false);

    await caller.create({
      ...base,
      defaultBranch: "trunk",
      name: "Plain",
      path: plain,
      initGit: true,
    });
    const head = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: plain });
    expect(head.toString().trim()).toBe("trunk");
  });
});
