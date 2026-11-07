import { exec } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { samePath } from "@exegol/shared";
import { afterAll, describe, expect, it } from "vitest";
import { execCli, findOnPath, hookShell } from "../agents/spawn-env";
import { execFileAsync } from "../lib/exec-file";
import { checkGitSync } from "../pipeline/pipeline-helpers";
import { readProcessTable } from "./process-table";

// No mocks on purpose: each case calls what the system really has, on its own CI runner
const WINDOWS = process.platform === "win32";
const made: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "exegol-os-"));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const git = (cwd: string, ...args: string[]) =>
  execFileAsync("git", ["-c", "user.name=t", "-c", "user.email=t@t.dev", ...args], { cwd });

describe("processes", () => {
  it("reads this process and its parent from the system's table", async () => {
    const rows = await readProcessTable();
    expect(rows.find((r) => r.pid === process.pid)?.ppid).toBe(process.ppid);
  });

  it.runIf(WINDOWS)("runs a repo hook in PowerShell, with its environment", async () => {
    const script = "echo $env:EXEGOL_OS_TEST";
    const { stdout } = await promisify(exec)(script, {
      ...hookShell(),
      env: { ...process.env, EXEGOL_OS_TEST: "held" },
    });
    expect(stdout.trim()).toBe("held");
  });
});

describe("CLIs as npm installs them", () => {
  it.runIf(WINDOWS)("prefers the .cmd over npm's extensionless POSIX script", () => {
    const dir = temp();
    writeFileSync(join(dir, "fake-cli"), "#!/bin/sh\n");
    writeFileSync(join(dir, "fake-cli.cmd"), "@echo off\r\n");
    expect(findOnPath("fake-cli", dir)?.toLowerCase()).toBe(
      join(dir, "fake-cli.cmd").toLowerCase(),
    );
  });

  it.runIf(WINDOWS)("passes hard arguments through a .cmd intact", async () => {
    const dir = temp();
    const printer = join(dir, "print.js");
    writeFileSync(printer, "console.log(JSON.stringify(process.argv.slice(2)))");
    const shim = join(dir, "fake-cli.cmd");
    writeFileSync(shim, `@echo off\r\nnode "${printer}" %*\r\n`);
    const args = ["two words", 'say "hi"', "100%", "a&b", "(x)", "José"];
    const { stdout } = await execCli(shim, args, {});
    expect(JSON.parse(stdout)).toEqual(args);
  });
});

describe("links and folders", () => {
  it("links a folder with no admin rights and reads the link back", () => {
    const dir = temp();
    const target = join(dir, "target");
    const link = join(dir, "link");
    mkdirSync(target);
    symlinkSync(target, link, "junction");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(samePath(readlinkSync(link), target)).toBe(true);
  });
});

describe("git", () => {
  it("counts unpushed commits", async () => {
    const dir = temp();
    const remote = join(dir, "remote.git");
    const work = join(dir, "work");
    await git(dir, "init", "--bare", "-b", "main", remote);
    await git(dir, "clone", remote, work);
    await git(work, "commit", "--allow-empty", "-m", "first");
    await git(work, "push", "-u", "origin", "HEAD:main");
    await git(work, "commit", "--allow-empty", "-m", "second");
    expect((await checkGitSync(work)).unpushedCommits).toBe(1);
  });
});
