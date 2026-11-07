import { exec } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { samePath } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { execCli, findOnPath, hookShell } from "../agents/spawn-env";
import { execFileAsync } from "../lib/exec-file";
import { checkGitSync } from "../pipeline/pipeline-helpers";
import { readProcessTable } from "./process-table";
import { duBytes } from "./storage";

// No mocks on purpose: each case calls what the system really has, on its own CI runner
const WINDOWS = process.platform === "win32";
const temp = () => mkdtempSync(join(tmpdir(), "exegol-os-"));

const git = (cwd: string, ...args: string[]) =>
  execFileAsync("git", ["-c", "user.name=t", "-c", "user.email=t@t.dev", ...args], { cwd });

describe("processes", () => {
  it("reads this process and its parent from the system's table", async () => {
    const rows = await readProcessTable();
    expect(rows.find((r) => r.pid === process.pid)?.ppid).toBe(process.ppid);
  });

  it("runs a repo hook in the system's shell, with its environment", async () => {
    const script = WINDOWS ? "echo $env:EXEGOL_OS_TEST" : "echo $EXEGOL_OS_TEST";
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
    expect(findOnPath("fake-cli", `${dir}${delimiter}`)?.toLowerCase()).toBe(
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

  it.runIf(WINDOWS)("takes both spellings of a Windows folder", () => {
    expect(isAbsolute("C:/x")).toBe(true);
    expect(isAbsolute("C:\\x")).toBe(true);
    expect(samePath("C:/Repo/", "c:\\repo")).toBe(true);
  });

  it("sizes a folder, and knows a missing one", async () => {
    const dir = temp();
    writeFileSync(join(dir, "a.txt"), "x".repeat(4096));
    expect(await duBytes(dir)).toBeGreaterThan(0);
    expect(await duBytes(join(dir, "missing"))).toBeNull();
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
