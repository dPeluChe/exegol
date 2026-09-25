import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectRunTargets,
  parseCustomActions,
  parseJustRecipes,
  parseMakeTargets,
} from "./scripts";

// These parsers decide what the launcher offers to RUN, so a false positive is
// a button that executes something meaningless — and a miss is a project whose
// only entry point is invisible.
describe("parseMakeTargets", () => {
  it("takes real targets and skips everything that only looks like one", () => {
    const make = [
      "CC := gcc",
      "SRC = main.c",
      ".PHONY: build test",
      "",
      "# a comment",
      "build:",
      "\tgo build ./...",
      "test: build",
      "\tgo test ./...",
      "%.o: %.c",
      "\t$(CC) -c $<",
      "\tindented: not-a-target",
    ].join("\n");

    expect(parseMakeTargets(make)).toEqual(["build", "test"]);
  });

  it("does not repeat a target declared twice", () => {
    expect(parseMakeTargets("build:\n\techo one\nbuild:\n\techo two")).toEqual(["build"]);
  });
});

describe("parseJustRecipes", () => {
  it("reads recipes with parameters and ignores assignments", () => {
    const just = [
      "set shell := ['bash', '-c']",
      "version := '1.0'",
      "# comment",
      "dev:",
      "  bun run dev",
      "deploy env='prod':",
      "  ./deploy.sh {{env}}",
    ].join("\n");

    expect(parseJustRecipes(just)).toEqual(["dev", "deploy"]);
  });
});

describe("parseCustomActions", () => {
  it("keeps the command verbatim, including colons and quotes", () => {
    const yaml = [
      "# project actions",
      "seed: bun run seed",
      'tunnel: "ssh -L 8080:localhost:80 box"',
      "",
    ].join("\n");

    expect(parseCustomActions(yaml)).toEqual([
      { name: "seed", command: "bun run seed" },
      { name: "tunnel", command: "ssh -L 8080:localhost:80 box" },
    ]);
  });

  it("ignores a line with no command", () => {
    expect(parseCustomActions("broken:\nalso-broken:   \n")).toEqual([]);
  });

  it("strips a trailing comment from an unquoted command", () => {
    expect(parseCustomActions("seed: bun run seed # dev only")).toEqual([
      { name: "seed", command: "bun run seed" },
    ]);
  });

  // These commands come out of a REPO — a clone must not be able to put
  // `rm -rf ~` behind a chip labelled "dev".
  it("refuses a command the safety guard rejects", () => {
    expect(parseCustomActions("dev: rm -rf ~/")).toEqual([]);
    expect(parseCustomActions("dev: bun run dev")).toHaveLength(1);
  });
});

describe("detectRunTargets (T197)", () => {
  it("lists nested repos and packages, with Convex where it is wired", async () => {
    const root = mkdtempSync(join(tmpdir(), "exegol-run-"));
    const pkg = (dir: string, body: object) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify(body));
    };
    // A workspace of repos: nothing runnable at the root
    mkdirSync(join(root, "backend", ".git"), { recursive: true });
    pkg(join(root, "backend"), { scripts: { dev: "vite" }, dependencies: { convex: "1" } });
    mkdirSync(join(root, "backend", "convex"));
    pkg(join(root, "apps", "web"), { scripts: { dev: "next dev" } });
    mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
    mkdirSync(join(root, "docs"));

    const targets = await detectRunTargets(root);
    const rels = targets.map((t) => t.rel);
    expect(rels).toEqual(["", "apps/web", "backend"]);
    const backend = targets.find((t) => t.rel === "backend");
    expect(backend?.git).toBe(true);
    expect(backend?.scripts[0]?.command).toBe("npx convex dev");
    expect(targets.find((t) => t.rel === "apps/web")?.scripts.map((s) => s.name)).toEqual(["dev"]);
  });
});
